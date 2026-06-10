# Agent

A minimal local CLI assistant for an [Ollama](https://ollama.com) model. Hands-off by default: it runs autonomously to completion, confirming only mutating tool calls outside the allowlist. Enable plan mode to have it propose a plan for approval first.

## Setup

1. Install and launch [Ollama](https://ollama.com), then download a model.
2. Clone this repo; copy `.env.example` to `.env` and set `MODEL`.
3. `npm link`, then run `sup` in any directory to start.

## Slash commands

Lines starting with `/` are commands. Typing `/` shows a live hint panel; `Tab` completes, `Enter` runs.

## Configuration

All settings come from `.env`, each with a sensible default. The main ones:

- `MODEL`, `LANGUAGE`, `HOST` — Ollama target and reply language.
- `USE_PLAN_MODE` (off) — investigate with read-only tools, then propose a plan for approval before anything mutates.
- `USE_AUTONOMOUS_MODE` (on) — run up to `AUTONOMOUS_STEP_BUDGET` tool calls without prompting. Set `false` to confirm each call.
- `USE_SHELL_TOOL` (off) — register the `run_shell` tool.
- `USE_PERMISSION_ALLOWLIST` — shell commands matching `AUTO_APPROVE_SHELL_PATTERNS` (in `src/config.ts`) skip the confirm-prompt.

See `.env.example` for the full list.

## Skills

Skills are reusable, on-demand instruction sets (like Claude Code skills), one per folder: `.sup/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`) and a Markdown body. Only the name and description go into the system prompt; when a task matches, the model loads the full body via the `skill` tool and may `read_file` sibling files in the folder. List them with `/skills`.

## Project instructions

If `AGENTS.md` is present in the working directory, it is appended to the system prompt at startup.

## Security

- Read-only tools (`read_file`, `glob`, `grep`) run without confirmation, scoped to the working directory.
- Mutating (`write_file`, `edit_file`, `run_shell`) and network (`web_search`, `fetch_url`) tools require a `[y / n / feedback]` prompt — unless autonomous mode is on or a shell command matches the allowlist.
