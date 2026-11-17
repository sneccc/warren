/**
 * HTTP surface of the sidecar. Bound to 127.0.0.1. Defences:
 * - Host header must be a loopback name (blocks DNS rebinding).
 * - POST needs a JSON content type and a same-origin Origin header
 *   (blocks cross-site form posts).
 * - Launch takes a proposal id, never a payload.
 */
import { type ChatEvent, type ChatTurnInput, runChatTurn } from "./claude.ts";
import type { OrchestratorConfig } from "./config.ts";
import { buildSystemPrompt, liveSnapshot } from "./context.ts";
import { type Proposal, extractProposals } from "./proposal.ts";
import { CHAT_PAGE } from "./ui.ts";
import type { WarrenApi } from "./warren.ts";

export type ChatFn = (cfg: OrchestratorConfig, input: ChatTurnInput) => AsyncGenerator<ChatEvent>;

export interface ServerDeps {
	cfg: OrchestratorConfig;
	api: WarrenApi;
	chat?: ChatFn;
	systemPrompt?: () => Promise<string>;
}

const MAX_PENDING = 200;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function createHandler(deps: ServerDeps): (req: Request) => Promise<Response> {
	const { cfg, api } = deps;
	const chat: ChatFn = deps.chat ?? ((c, i) => runChatTurn(c, i));
	const systemPrompt = deps.systemPrompt ?? (() => buildSystemPrompt(cfg, api));
	const pending = new Map<string, { proposal: Proposal; launched: boolean }>();
	let counter = 0;

	function register(proposal: Proposal): string {
		const id = `prop_${Date.now().toString(36)}_${(counter++).toString(36)}`;
		pending.set(id, { proposal, launched: false });
		if (pending.size > MAX_PENDING) {
			const oldest = pending.keys().next().value;
			if (oldest !== undefined) pending.delete(oldest);
		}
		return id;
	}

	async function launch(p: Proposal): Promise<unknown> {
		switch (p.kind) {
			case "run": {
				const body: Record<string, unknown> = {
					agent: p.agent,
					project: p.project,
					prompt: p.prompt,
					maxCostUsd: p.maxCostUsd,
					dispatcherHandle: "orchestrator",
				};
				if (p.branch) body.ref = p.branch;
				return api.post("/runs", body);
			}
			case "plan-run":
				return api.post("/plan-runs", {
					project: p.project,
					planId: p.planId,
					agent: p.agent,
					maxCostUsd: p.maxCostUsd,
					dispatcherHandle: "orchestrator",
				});
			case "steer":
				return api.post(`/runs/${encodeURIComponent(p.runId)}/steer`, { body: p.body, fromActor: "orchestrator" });
			case "cancel":
				return api.post(`/runs/${encodeURIComponent(p.runId)}/cancel`, p.reason ? { reason: p.reason } : {});
		}
	}

	function guard(req: Request): Response | null {
		const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
		if (!LOOPBACK.has(host)) return json(403, { error: "bad host" });
		if (req.method === "POST") {
			if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json(415, { error: "json only" });
			const origin = req.headers.get("origin");
			if (origin !== null && new URL(origin).host !== req.headers.get("host")) return json(403, { error: "bad origin" });
		}
		return null;
	}

	return async (req) => {
		const bad = guard(req);
		if (bad) return bad;
		const url = new URL(req.url);
		if (req.method === "GET" && url.pathname === "/") {
			return new Response(CHAT_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		}
		if (req.method === "GET" && url.pathname === "/api/state") {
			return json(200, { model: cfg.model, effort: cfg.effort, snapshot: await liveSnapshot(api) });
		}
		if (req.method === "POST" && url.pathname === "/api/chat") {
			const body = (await req.json().catch(() => null)) as { message?: unknown; sessionId?: unknown } | null;
			const message = typeof body?.message === "string" ? body.message.trim() : "";
			if (!message || message.length > 20000) return json(400, { error: "message must be 1 to 20000 characters" });
			const sessionId = typeof body?.sessionId === "string" && /^[0-9a-f-]{36}$/.test(body.sessionId) ? body.sessionId : undefined;
			const enc = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				async start(controller) {
					const send = (o: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
					try {
						const sys = await systemPrompt();
						for await (const ev of chat(cfg, { message, systemPrompt: sys, sessionId })) {
							if (ev.t === "done") {
								for (const b of extractProposals(ev.text, cfg)) {
									if (b.proposal) send({ t: "proposal", id: register(b.proposal), proposal: b.proposal });
									else send({ t: "proposal-error", message: b.error });
								}
							}
							send(ev);
						}
					} catch (e) {
						send({ t: "error", message: (e as Error).message });
					} finally {
						controller.close();
					}
				},
			});
			return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
		}
		if (req.method === "POST" && url.pathname === "/api/launch") {
			const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
			const entry = typeof body?.id === "string" ? pending.get(body.id) : undefined;
			if (!entry) return json(404, { error: "unknown proposal id" });
			if (entry.launched) return json(409, { error: "proposal already launched" });
			entry.launched = true;
			try {
				return json(200, { ok: true, result: await launch(entry.proposal) });
			} catch (e) {
				entry.launched = false;
				return json(502, { ok: false, error: (e as Error).message });
			}
		}
		return json(404, { error: "not found" });
	};
}

export function startServer(deps: ServerDeps) {
	return Bun.serve({ hostname: "127.0.0.1", port: deps.cfg.port, idleTimeout: 255, fetch: createHandler(deps) });
}
