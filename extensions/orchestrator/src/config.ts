/**
 * Environment contract of the orchestrator sidecar. Every value has a
 * default that works on a single-owner WSL box.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface OrchestratorConfig {
	/** Port of the sidecar HTTP server (bound to 127.0.0.1 only). */
	readonly port: number;
	/** Base URL of the Warren server this sidecar controls. */
	readonly warrenBaseUrl: string;
	/** File that holds the Warren operator token. Read on every call. */
	readonly tokenFile: string;
	/** Absolute path of the Linux `claude` binary. */
	readonly claudeBin: string;
	readonly model: string;
	readonly effort: string;
	/** Working directory of the chat agent. It can only read here. */
	readonly claudeCwd: string;
	/** Path of the knowledge pack that becomes the system prompt. */
	readonly guidePath: string;
	/** Per-run spend cap (USD) when a proposal gives none. */
	readonly defaultMaxCostUsd: number;
	/** Largest per-run spend cap (USD) a proposal may ask for. */
	readonly maxCostCeilingUsd: number;
}

const HERE = import.meta.dir;

export function loadConfig(env: Record<string, string | undefined> = process.env): OrchestratorConfig {
	const home = env.HOME ?? homedir();
	return {
		port: Number(env.ORCH_PORT ?? 8100),
		warrenBaseUrl: (env.ORCH_WARREN_URL ?? "http://127.0.0.1:8090").replace(/\/+$/, ""),
		tokenFile: env.ORCH_TOKEN_FILE ?? join(home, ".warren", "data", "operator-token"),
		claudeBin: env.ORCH_CLAUDE_BIN ?? join(home, ".local", "bin", "claude"),
		model: env.ORCH_MODEL ?? "claude-sonnet-5-5",
		effort: env.ORCH_EFFORT ?? "high",
		claudeCwd: resolve(env.ORCH_CWD ?? join(HERE, "..", "..", "..")),
		guidePath: env.ORCH_GUIDE ?? join(HERE, "..", "knowledge", "warren-guide.md"),
		defaultMaxCostUsd: Number(env.ORCH_DEFAULT_MAX_COST_USD ?? 5),
		maxCostCeilingUsd: Number(env.ORCH_MAX_COST_CEILING_USD ?? 25),
	};
}

export function readToken(cfg: OrchestratorConfig): string {
	return readFileSync(cfg.tokenFile, "utf8").trim();
}
