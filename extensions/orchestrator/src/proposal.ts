/**
 * Proposals: the only way the chat agent can cause an action. The agent
 * writes a fenced block tagged `warren-proposal` that holds one JSON
 * object. The server validates it, keeps it under an id, and the owner
 * launches it with a click. The browser sends back the id only, never the
 * payload, so a click cannot launch anything the agent did not write.
 */
import type { OrchestratorConfig } from "./config.ts";

export const OWNER_QUESTIONS_SUFFIX =
	'\n\nIf you need an owner decision, put the questions in a commit-body block that starts with the line "Questions for the owner:". Do not guess.';

export interface RunProposal {
	kind: "run";
	title: string;
	project: string;
	agent: string;
	prompt: string;
	maxCostUsd: number;
	branch?: string;
}
export interface PlanRunProposal {
	kind: "plan-run";
	title: string;
	project: string;
	planId: string;
	agent: string;
	maxCostUsd: number;
}
export interface SteerProposal {
	kind: "steer";
	title: string;
	runId: string;
	body: string;
}
export interface CancelProposal {
	kind: "cancel";
	title: string;
	runId: string;
	reason?: string;
}
export type Proposal = RunProposal | PlanRunProposal | SteerProposal | CancelProposal;

export interface ParsedBlock {
	proposal?: Proposal;
	error?: string;
}

const BLOCK_RE = /```warren-proposal[^\n]*\n([\s\S]*?)```/g;

export function extractProposals(text: string, cfg: OrchestratorConfig): ParsedBlock[] {
	const out: ParsedBlock[] = [];
	for (const m of text.matchAll(BLOCK_RE)) {
		out.push(validateProposal(m[1] ?? "", cfg));
	}
	return out;
}

function str(v: unknown, max: number): string | null {
	return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

export function validateProposal(raw: string, cfg: OrchestratorConfig): ParsedBlock {
	let obj: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { error: "proposal is not a JSON object" };
		}
		obj = parsed as Record<string, unknown>;
	} catch (e) {
		return { error: `proposal is not valid JSON: ${(e as Error).message}` };
	}
	const title = str(obj.title, 120);
	if (!title) return { error: "proposal needs a title (1 to 120 characters)" };
	const cost = obj.maxCostUsd === undefined ? cfg.defaultMaxCostUsd : obj.maxCostUsd;
	const needCost = obj.kind === "run" || obj.kind === "plan-run";
	if (needCost && (typeof cost !== "number" || !(cost > 0) || cost > cfg.maxCostCeilingUsd)) {
		return { error: `maxCostUsd must be a number above 0 and at most ${cfg.maxCostCeilingUsd}` };
	}
	switch (obj.kind) {
		case "run": {
			const project = str(obj.project, 100);
			const prompt = str(obj.prompt, 20000);
			if (!project || !prompt) return { error: "run needs project and prompt" };
			const p: RunProposal = {
				kind: "run",
				title,
				project,
				agent: str(obj.agent, 60) ?? "claude-code",
				prompt: prompt.includes("Questions for the owner:") ? prompt : prompt + OWNER_QUESTIONS_SUFFIX,
				maxCostUsd: cost as number,
			};
			const branch = str(obj.branch, 200);
			if (branch) p.branch = branch;
			return { proposal: p };
		}
		case "plan-run": {
			const project = str(obj.project, 100);
			const planId = str(obj.planId, 100);
			if (!project || !planId) return { error: "plan-run needs project and planId" };
			return {
				proposal: {
					kind: "plan-run",
					title,
					project,
					planId,
					agent: str(obj.agent, 60) ?? "claude-code",
					maxCostUsd: cost as number,
				},
			};
		}
		case "steer": {
			const runId = str(obj.runId, 100);
			const body = str(obj.body, 8000);
			if (!runId || !body) return { error: "steer needs runId and body" };
			return { proposal: { kind: "steer", title, runId, body } };
		}
		case "cancel": {
			const runId = str(obj.runId, 100);
			if (!runId) return { error: "cancel needs runId" };
			const p: CancelProposal = { kind: "cancel", title, runId };
			const reason = str(obj.reason, 400);
			if (reason) p.reason = reason;
			return { proposal: p };
		}
		default:
			return { error: `unknown proposal kind: ${String(obj.kind)}` };
	}
}
