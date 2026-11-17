/**
 * Minimal Warren HTTP client for the orchestrator. It uses only the
 * published HTTP surface (docs/http-api.md). The operator token stays in
 * this process: it is never sent to the browser and never passed to the
 * chat agent.
 */
import { type OrchestratorConfig, readToken } from "./config.ts";

export type FetchFn = typeof fetch;

export class WarrenHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "WarrenHttpError";
	}
}

export interface WarrenApi {
	get<T>(path: string): Promise<T>;
	post<T>(path: string, body: unknown): Promise<T>;
}

export function createWarrenApi(cfg: OrchestratorConfig, fetchFn: FetchFn = fetch): WarrenApi {
	async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const headers: Record<string, string> = { authorization: `Bearer ${readToken(cfg)}` };
		if (body !== undefined) headers["content-type"] = "application/json";
		const res = await fetchFn(`${cfg.warrenBaseUrl}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new WarrenHttpError(res.status, `Warren ${method} ${path} returned ${res.status}: ${text.slice(0, 400)}`);
		}
		return (text ? JSON.parse(text) : {}) as T;
	}
	return {
		get: (path) => call("GET", path),
		post: (path, body) => call("POST", path, body ?? {}),
	};
}
