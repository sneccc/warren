import { loadConfig, readToken } from "./config.ts";
import { startServer } from "./server.ts";
import { createWarrenApi } from "./warren.ts";

const cfg = loadConfig();
try {
	readToken(cfg);
} catch (e) {
	console.error(`orchestrator: cannot read the Warren token at ${cfg.tokenFile}: ${(e as Error).message}`);
	process.exit(1);
}
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
	console.error("orchestrator: CLAUDE_CODE_OAUTH_TOKEN is not set. Load ~/.warren/env first (see orchestrator-up.sh).");
	process.exit(1);
}
const server = startServer({ cfg, api: createWarrenApi(cfg) });
console.log(`orchestrator: http://127.0.0.1:${server.port}  model ${cfg.model} effort ${cfg.effort}  warren ${cfg.warrenBaseUrl}`);
