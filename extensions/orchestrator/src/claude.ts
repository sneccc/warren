/**
 * Runs one chat turn through the Claude CLI and turns its stream-json
 * output into small events for the browser.
 *
 * The agent is read-only: it may use Read, Grep and Glob inside the fork
 * folder and nothing else. It cannot run shell commands, edit files or
 * reach the network. Its only way to act is a proposal block (proposal.ts).
 * Only HOME, PATH and the subscription token reach the child process, so
 * the Warren operator token never does.
 */
import type { OrchestratorConfig } from "./config.ts";

export type ChatEvent =
	| { t: "delta"; text: string }
	| { t: "tool"; name: string }
	| { t: "done"; sessionId: string; costUsd: number | null; text: string }
	| { t: "error"; message: string };

/** Parse one stream-json line. Returns null for lines the UI does not need. */
export function parseStreamLine(line: string): ChatEvent | null {
	let o: Record<string, unknown>;
	try {
		o = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (o.type === "stream_event") {
		const ev = o.event as { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string; name?: string } } | undefined;
		if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
			return { t: "delta", text: ev.delta.text };
		}
		if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use" && ev.content_block.name) {
			return { t: "tool", name: ev.content_block.name };
		}
		return null;
	}
	if (o.type === "result") {
		const sessionId = typeof o.session_id === "string" ? o.session_id : "";
		if (o.is_error === true) {
			return { t: "error", message: typeof o.result === "string" ? o.result : "Claude returned an error" };
		}
		return {
			t: "done",
			sessionId,
			costUsd: typeof o.total_cost_usd === "number" ? o.total_cost_usd : null,
			text: typeof o.result === "string" ? o.result : "",
		};
	}
	return null;
}

export function buildClaudeArgs(cfg: OrchestratorConfig, message: string, systemPrompt: string, sessionId?: string): string[] {
	const args = [
		"-p",
		message,
		"--model",
		cfg.model,
		"--effort",
		cfg.effort,
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--allowedTools",
		"Read,Grep,Glob",
		"--disallowedTools",
		"Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task",
		"--append-system-prompt",
		systemPrompt,
	];
	if (sessionId) args.push("--resume", sessionId);
	return args;
}

export function childEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const out: Record<string, string> = {};
	for (const k of ["HOME", "PATH", "LANG", "CLAUDE_CODE_OAUTH_TOKEN"]) {
		const v = env[k];
		if (v) out[k] = v;
	}
	return out;
}

export interface ChatTurnInput {
	message: string;
	systemPrompt: string;
	sessionId?: string;
}

export type SpawnFn = typeof Bun.spawn;

/** Stream one chat turn. The generator ends after a `done` or `error` event. */
export async function* runChatTurn(
	cfg: OrchestratorConfig,
	input: ChatTurnInput,
	spawn: SpawnFn = Bun.spawn,
	env: Record<string, string | undefined> = process.env,
): AsyncGenerator<ChatEvent> {
	const proc = spawn([cfg.claudeBin, ...buildClaudeArgs(cfg, input.message, input.systemPrompt, input.sessionId)], {
		cwd: cfg.claudeCwd,
		env: childEnv(env),
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	let finished = false;
	const decoder = new TextDecoder();
	let buf = "";
	const stdout = proc.stdout as ReadableStream<Uint8Array>;
	for await (const chunk of stdout) {
		buf += decoder.decode(chunk, { stream: true });
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			const ev = parseStreamLine(buf.slice(0, nl));
			buf = buf.slice(nl + 1);
			nl = buf.indexOf("\n");
			if (ev) {
				if (ev.t === "done" || ev.t === "error") finished = true;
				yield ev;
			}
		}
	}
	const tail = parseStreamLine(buf);
	if (tail) {
		if (tail.t === "done" || tail.t === "error") finished = true;
		yield tail;
	}
	const code = await proc.exited;
	if (!finished) {
		const err = proc.stderr ? await new Response(proc.stderr as ReadableStream).text() : "";
		yield { t: "error", message: `claude exited with code ${code}. ${err.slice(0, 400)}`.trim() };
	}
}
