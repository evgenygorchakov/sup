# sup

A minimal CLI agent for local [Ollama](https://ollama.com) models. Autonomous by default: it runs tool calls to completion without prompting. Optional plan mode (`USE_PLAN_MODE`) proposes a plan for approval before any changes.

## Setup

1. Install [Ollama](https://ollama.com), pull a model.
2. Copy `.env.example` to `.env`, set `MODEL`.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan mode / thinking / verbose output, list saved plans, clear history.
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed to keep the context short.
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- `AGENTS.md` in the working directory is appended to the system prompt.
- Skills (like Claude Code skills): drop `.sup/skills/<name>/SKILL.md` with `name` + `description` frontmatter; the body is loaded on demand via the `skill` tool.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Mutating and network tools ask `[y / n / feedback]` — unless autonomous mode is on. Shell commands are the exception: only those matching the read-only allowlist in `src/config.ts` run without confirmation; anything else asks even in autonomous mode. In plan mode, allowlisted read-only shell commands are available during exploration.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
