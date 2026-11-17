import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { OWNER_QUESTIONS_SUFFIX, extractProposals, validateProposal } from "./proposal.ts";

const cfg = loadConfig({ HOME: "/home/x" });
const fence = (body: string) => `text\n\`\`\`warren-proposal\n${body}\n\`\`\`\nmore`;

describe("validateProposal", () => {
	test("accepts a run and adds the owner-questions rule", () => {
		const r = validateProposal('{"kind":"run","title":"T","project":"prj_1","prompt":"Do it"}', cfg);
		expect(r.error).toBeUndefined();
		expect(r.proposal).toMatchObject({ kind: "run", agent: "claude-code", maxCostUsd: 5 });
		expect(r.proposal && r.proposal.kind === "run" && r.proposal.prompt).toBe(`Do it${OWNER_QUESTIONS_SUFFIX}`);
	});

	test("keeps a prompt that already has the owner-questions rule", () => {
		const prompt = "Do it. Questions for the owner: ask.";
		const r = validateProposal(JSON.stringify({ kind: "run", title: "T", project: "p", prompt }), cfg);
		expect(r.proposal && r.proposal.kind === "run" && r.proposal.prompt).toBe(prompt);
	});

	test("rejects cost above the ceiling and non-positive cost", () => {
		for (const c of [26, 0, -1, "5"]) {
			const r = validateProposal(JSON.stringify({ kind: "run", title: "T", project: "p", prompt: "x", maxCostUsd: c }), cfg);
			expect(r.error).toContain("maxCostUsd");
		}
	});

	test("accepts plan-run, steer and cancel", () => {
		expect(validateProposal('{"kind":"plan-run","title":"T","project":"p","planId":"pl-1"}', cfg).proposal?.kind).toBe("plan-run");
		expect(validateProposal('{"kind":"steer","title":"T","runId":"run_1","body":"hi"}', cfg).proposal?.kind).toBe("steer");
		expect(validateProposal('{"kind":"cancel","title":"T","runId":"run_1"}', cfg).proposal?.kind).toBe("cancel");
	});

	test("rejects missing fields, bad JSON and unknown kinds", () => {
		expect(validateProposal('{"kind":"run","title":"T","project":"p"}', cfg).error).toContain("prompt");
		expect(validateProposal("not json", cfg).error).toContain("JSON");
		expect(validateProposal('{"kind":"delete","title":"T"}', cfg).error).toContain("unknown");
		expect(validateProposal('{"kind":"run","project":"p","prompt":"x"}', cfg).error).toContain("title");
		expect(validateProposal("[1]", cfg).error).toContain("object");
	});
});

describe("extractProposals", () => {
	test("finds each block and ignores other fences", () => {
		const text = `${fence('{"kind":"cancel","title":"A","runId":"r1"}')}\n\`\`\`js\nx\n\`\`\`\n${fence('{"kind":"bad"}')}`;
		const out = extractProposals(text, cfg);
		expect(out).toHaveLength(2);
		expect(out[0]?.proposal?.kind).toBe("cancel");
		expect(out[1]?.error).toBeDefined();
	});
});
