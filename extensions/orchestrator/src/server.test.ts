import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "./claude.ts";
import { loadConfig } from "./config.ts";
import { createHandler } from "./server.ts";
import type { WarrenApi } from "./warren.ts";

const cfg = loadConfig({ HOME: "/home/x" });

function fakeApi() {
	const calls: { path: string; body: unknown }[] = [];
	const api: WarrenApi = {
		get: async () => ({ projects: [], runs: [], planRuns: [] }) as never,
		post: async (path, body) => {
			calls.push({ path, body });
			return { run: { id: "run_new" } } as never;
		},
	};
	return { api, calls };
}

const PROPOSAL = '```warren-proposal\n{"kind":"run","title":"T","project":"prj_1","prompt":"Do it","maxCostUsd":2}\n```';

function handler() {
	const { api, calls } = fakeApi();
	const h = createHandler({
		cfg,
		api,
		systemPrompt: async () => "SYS",
		chat: async function* (): AsyncGenerator<ChatEvent> {
			yield { t: "delta", text: "ok" };
			yield { t: "done", sessionId: "11111111-1111-1111-1111-111111111111", costUsd: 0.1, text: `ok\n${PROPOSAL}` };
		},
	});
	return { h, calls };
}

const H = { host: "127.0.0.1:8100", "content-type": "application/json", origin: "http://127.0.0.1:8100" };
const post = (path: string, body: unknown, headers: Record<string, string> = H) =>
	new Request(`http://127.0.0.1:8100${path}`, { method: "POST", headers, body: JSON.stringify(body) });

async function chatEvents(h: (r: Request) => Promise<Response>) {
	const res = await h(post("/api/chat", { message: "hi" }));
	const text = await res.text();
	return text.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("guards", () => {
	test("rejects a non-loopback host", async () => {
		const { h } = handler();
		const res = await h(new Request("http://evil.test/", { headers: { host: "evil.test" } }));
		expect(res.status).toBe(403);
	});
	test("rejects a cross-origin POST and a non-JSON POST", async () => {
		const { h } = handler();
		expect((await h(post("/api/launch", { id: "x" }, { ...H, origin: "http://evil.test" }))).status).toBe(403);
		expect((await h(post("/api/launch", { id: "x" }, { host: H.host, "content-type": "text/plain" }))).status).toBe(415);
	});
	test("serves the page", async () => {
		const { h } = handler();
		const res = await h(new Request("http://127.0.0.1:8100/", { headers: { host: H.host } }));
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Warren Orchestrator");
	});
});

describe("chat and launch", () => {
	test("chat streams a proposal, launch posts it once", async () => {
		const { h, calls } = handler();
		const events = await chatEvents(h);
		const prop = events.find((e) => e.t === "proposal") as { id: string } | undefined;
		expect(prop).toBeDefined();
		expect(events.at(-1)?.t).toBe("done");

		const res = await h(post("/api/launch", { id: prop?.id }));
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.path).toBe("/runs");
		expect(calls[0]?.body).toMatchObject({ project: "prj_1", agent: "claude-code", maxCostUsd: 2, dispatcherHandle: "orchestrator" });

		const again = await h(post("/api/launch", { id: prop?.id }));
		expect(again.status).toBe(409);
		expect(calls).toHaveLength(1);
	});

	test("launch rejects an unknown id and never takes a payload", async () => {
		const { h, calls } = handler();
		const res = await h(post("/api/launch", { id: "nope", proposal: { kind: "run" } }));
		expect(res.status).toBe(404);
		expect(calls).toHaveLength(0);
	});

	test("chat rejects an empty message", async () => {
		const { h } = handler();
		expect((await h(post("/api/chat", { message: "  " }))).status).toBe(400);
	});
});
