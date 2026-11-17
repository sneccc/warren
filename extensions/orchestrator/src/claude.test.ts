import { describe, expect, test } from "bun:test";
import { buildClaudeArgs, childEnv, parseStreamLine, runChatTurn } from "./claude.ts";
import { loadConfig } from "./config.ts";

const cfg = loadConfig({ HOME: "/home/x" });

describe("parseStreamLine", () => {
	test("text delta", () => {
		const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } });
		expect(parseStreamLine(line)).toEqual({ t: "delta", text: "Hi" });
	});
	test("thinking delta and bad JSON are ignored", () => {
		const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "x" } } });
		expect(parseStreamLine(line)).toBeNull();
		expect(parseStreamLine("{oops")).toBeNull();
	});
	test("tool start", () => {
		const line = JSON.stringify({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } });
		expect(parseStreamLine(line)).toEqual({ t: "tool", name: "Read" });
	});
	test("result becomes done, error result becomes error", () => {
		expect(parseStreamLine(JSON.stringify({ type: "result", session_id: "s1", total_cost_usd: 0.2, result: "ok" }))).toEqual({
			t: "done",
			sessionId: "s1",
			costUsd: 0.2,
			text: "ok",
		});
		expect(parseStreamLine(JSON.stringify({ type: "result", is_error: true, result: "boom" }))).toEqual({ t: "error", message: "boom" });
	});
});

describe("buildClaudeArgs", () => {
	test("is read-only, uses the model and effort, and resumes", () => {
		const a = buildClaudeArgs(cfg, "hello", "SYS", "11111111-1111-1111-1111-111111111111");
		expect(a).toContain("claude-sonnet-5-5");
		expect(a[a.indexOf("--effort") + 1]).toBe("high");
		expect(a[a.indexOf("--allowedTools") + 1]).toBe("Read,Grep,Glob");
		expect(a[a.indexOf("--disallowedTools") + 1]).toContain("Bash");
		expect(a[a.indexOf("--resume") + 1]).toBe("11111111-1111-1111-1111-111111111111");
		expect(buildClaudeArgs(cfg, "hello", "SYS")).not.toContain("--resume");
	});
});

describe("childEnv", () => {
	test("passes only the needed variables", () => {
		const e = childEnv({ HOME: "/h", PATH: "/p", CLAUDE_CODE_OAUTH_TOKEN: "t", WARREN_GIT_TOKEN: "secret", ANTHROPIC_API_KEY: "k" });
		expect(Object.keys(e).sort()).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"]);
	});
});

function fakeSpawn(lines: string[], exitCode = 0, stderr = ""): typeof Bun.spawn {
	const enc = new TextEncoder();
	return (() => ({
		stdout: new ReadableStream({
			start(c) {
				c.enqueue(enc.encode(lines.join("\n")));
				c.close();
			},
		}),
		stderr: new Response(stderr).body,
		exited: Promise.resolve(exitCode),
	})) as unknown as typeof Bun.spawn;
}

describe("runChatTurn", () => {
	test("streams events until done", async () => {
		const lines = [
			JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "A" } } }),
			JSON.stringify({ type: "result", session_id: "s", total_cost_usd: 0.1, result: "A" }),
		];
		const out = [];
		for await (const ev of runChatTurn(cfg, { message: "m", systemPrompt: "s" }, fakeSpawn(lines), {})) out.push(ev);
		expect(out.map((e) => e.t)).toEqual(["delta", "done"]);
	});

	test("reports an error when the process ends with no result", async () => {
		const out = [];
		for await (const ev of runChatTurn(cfg, { message: "m", systemPrompt: "s" }, fakeSpawn([], 1, "login needed"), {})) out.push(ev);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ t: "error" });
		expect(JSON.stringify(out[0])).toContain("login needed");
	});
});
