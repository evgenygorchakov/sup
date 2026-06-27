# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Autonomous by default: it runs tool calls to completion without prompting. Optional plan mode (`USE_PLAN_MODE`) proposes a plan for approval before any changes.

## Setup

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`)/`MODEL`.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan mode / thinking / verbose output, list saved plans, clear history.
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed to keep the context short. Models without native tool calling fall back to prompt-engineered tools (`USE_NATIVE_TOOLS=false`).
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- `AGENTS.md` in the working directory is appended to the system prompt.
- Skills (like Claude Code skills): drop `.sup/skills/<name>/SKILL.md` with `name` + `description` frontmatter; the body is loaded on demand via the `skill` tool.

## Babysitter mode

Optional deterministic control inspired by [a5c-ai/babysitter](https://github.com/a5c-ai/babysitter), off by default (`USE_BABYSITTER=true` to enable). All of it lives in `src/babysitter/`; with the flag off the agent behaves exactly as before.

- **Verification gate** — when a plan or gated skill is active, the agent cannot end a turn until the commands in its `Verification` section pass. Failures are fed back and the loop continues, bounded by `BABYSITTER_GATE_MAX_ATTEMPTS`.
- **Journal + resume** — every step is appended to `.sup/runs/<id>/journal.jsonl`. `sup --resume` (or `sup --resume=<id>`) restores the conversation and the step ledger.
- **TODO ledger** — a plan's numbered `Steps` become a tracked checklist re-injected each turn; the model marks progress with the `ledger_update` tool.
- **Gated skills** — a `SKILL.md` with a `## Steps` section drives the model step-by-step, and its `## Verification` section feeds the gate.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Mutating and network tools run without confirmation. Shell commands are the exception: only those matching the read-only allowlist in `src/config.ts` run unattended; anything else asks `[y / n / feedback]`. In plan mode, allowlisted read-only shell commands are available during exploration.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
