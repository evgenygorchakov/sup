# sup

A minimal CLI agent for local [Ollama](https://ollama.com) models. Autonomous by default: it runs tool calls to completion without prompting. Optional plan mode (`USE_PLAN_MODE`) proposes a plan for approval before any changes.

## Setup

1. Install [Ollama](https://ollama.com), pull a model.
2. Copy `.env.example` to `.env`, set `MODEL`.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan mode / thinking / verbose output, list saved plans, clear history.
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- `AGENTS.md` in the working directory is appended to the system prompt.
- Skills (like Claude Code skills): drop `.sup/skills/<name>/SKILL.md` with `name` + `description` frontmatter; the body is loaded on demand via the `skill` tool.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Mutating and network tools ask `[y / n / feedback]` — unless autonomous mode is on or a shell command matches the read-only allowlist in `src/config.ts`.
- The shell tool is off by default (`USE_SHELL_TOOL=true` to enable).
