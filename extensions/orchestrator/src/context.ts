/**
 * Builds the system prompt: the static knowledge pack plus a short live
 * snapshot of the Warren instance (projects, recent runs, plan runs).
 * Live data is fetched on every turn, so the agent never works from old
 * state. A failed fetch becomes one line of text, never an error.
 */
import { readFileSync } from "node:fs";
import type { OrchestratorConfig } from "./config.ts";
import type { WarrenApi } from "./warren.ts";

interface Project {
	id: string;
	gitUrl: string;
	defaultBranch: string;
	hasSeeds?: boolean;
}
interface Run {
	id: string;
	agentName: string;
	projectId: string | null;
	state: string;
	prUrl: string | null;
	prState?: string | null;
	createdAt: number | null;
	prompt?: string;
}
interface PlanRun {
	id: string;
	planId: string | null;
	projectId: string;
	state: string;
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | string> {
	try {
		return await fn();
	} catch (e) {
		return `${label} unavailable: ${(e as Error).message.slice(0, 160)}`;
	}
}

export async function liveSnapshot(api: WarrenApi): Promise<string> {
	const [projects, runs, plans] = await Promise.all([
		safe("projects", () => api.get<{ projects: Project[] }>("/projects")),
		safe("runs", () => api.get<{ runs: Run[] }>("/runs")),
		safe("plan runs", () => api.get<{ planRuns: PlanRun[] }>("/plan-runs")),
	]);
	const lines: string[] = ["## Live state (fetched just now)", "", "Projects:"];
	if (typeof projects === "string") lines.push(`- ${projects}`);
	else {
		for (const p of projects.projects) lines.push(`- ${p.id}  ${p.gitUrl}  branch ${p.defaultBranch}  seeds ${p.hasSeeds ? "yes" : "no"}`);
	}
	lines.push("", "Recent runs (newest first, at most 10):");
	if (typeof runs === "string") lines.push(`- ${runs}`);
	else {
		const sorted = [...runs.runs].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 10);
		for (const r of sorted) {
			lines.push(`- ${r.id}  ${r.state}  project ${r.projectId}  agent ${r.agentName}  pr ${r.prUrl ?? "none"}${r.prState ? ` (${r.prState})` : ""}  prompt: ${(r.prompt ?? "").replace(/\s+/g, " ").slice(0, 80)}`);
		}
	}
	lines.push("", "Plan runs:");
	if (typeof plans === "string") lines.push(`- ${plans}`);
	else if (plans.planRuns.length === 0) lines.push("- none");
	else for (const p of plans.planRuns.slice(0, 10)) lines.push(`- ${p.id}  ${p.state}  project ${p.projectId}  plan ${p.planId}`);
	return lines.join("\n");
}

export function readGuide(cfg: OrchestratorConfig): string {
	return readFileSync(cfg.guidePath, "utf8");
}

export async function buildSystemPrompt(cfg: OrchestratorConfig, api: WarrenApi): Promise<string> {
	return `${readGuide(cfg)}\n\n${await liveSnapshot(api)}\n`;
}
