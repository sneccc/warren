# @warren-ext/orchestrator

A chat page where Claude advises the owner and proposes Warren runs. The owner launches each proposal with one click. This is a standalone Bun package. It uses only Warren's published HTTP API and the Claude CLI. Core Warren does not import it.

## What it does

- Serves a chat page on `http://127.0.0.1:8100`.
- Each chat turn runs `claude -p --model claude-sonnet-5-5 --effort high --resume <session>`. The system prompt is [`knowledge/warren-guide.md`](knowledge/warren-guide.md) plus a live snapshot of projects, recent runs and plan runs.
- The agent can write a fenced `warren-proposal` JSON block. The server validates it and shows a **Launch card**. A click on Launch calls Warren (`POST /runs`, `POST /plan-runs`, `POST /runs/:id/steer`, `POST /runs/:id/cancel`).
- To change Warren itself, the owner registers the fork as a Warren project. The agent then proposes a run on that project like on any other project.

## Safety

- The chat agent is read-only: `Read`, `Grep` and `Glob` in the fork folder. `Bash`, `Edit`, `Write`, web tools and sub-agents are denied.
- The child process gets only `HOME`, `PATH`, `LANG` and `CLAUDE_CODE_OAUTH_TOKEN`. The Warren operator token stays in the sidecar.
- Launch takes a proposal id. The browser never sends a payload.
- Each proposal has a spend cap (`maxCostUsd`, default 5, ceiling 25).
- Run prompts get a standing rule: ask the owner by a "Questions for the owner:" block in the commit body.
- The server binds to `127.0.0.1`. It checks the `Host` header, the `Origin` header and the JSON content type on every POST.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | required | Claude subscription token for the chat |
| `ORCH_PORT` | `8100` | Sidecar port |
| `ORCH_WARREN_URL` | `http://127.0.0.1:8090` | Warren base URL |
| `ORCH_TOKEN_FILE` | `~/.warren/data/operator-token` | Warren operator token file |
| `ORCH_CLAUDE_BIN` | `~/.local/bin/claude` | Linux `claude` binary |
| `ORCH_MODEL` | `claude-sonnet-5-5` | Chat model |
| `ORCH_EFFORT` | `high` | Chat effort |
| `ORCH_CWD` | the fork root | Folder the agent may read |
| `ORCH_DEFAULT_MAX_COST_USD` | `5` | Cap when a proposal gives none |
| `ORCH_MAX_COST_CEILING_USD` | `25` | Largest cap a proposal may ask for |

## Run

```bash
cd extensions/orchestrator
bun install
CLAUDE_CODE_OAUTH_TOKEN=... bun run start
```

On the owner's machine, `orchestrator-up.sh` in the setup folder loads the token and starts it.

## Test

```bash
bun test
bun run typecheck
```
