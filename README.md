# Agent

A minimal local CLI assistant for an [Ollama](https://ollama.com) model. Plan-first and hands-off by default: it investigates your code with read-only tools, proposes a plan for your approval, then runs autonomously to completion. Turn autonomous mode off to confirm each tool call.

## Setup

1. Install and launch [Ollama](https://ollama.com), then download a model.
2. Clone this repo; copy `.env.example` to `.env` and set `MODEL`.
3. `npm link`, then run `sup` in any directory to start.

## Slash commands

Lines starting with `/` are commands. Typing `/` shows a live hint panel; `Tab` completes, `Enter` runs. Interactive menus use ↑/↓, `Enter` to confirm, `Esc` to cancel.

- `/help` — list commands.
- `/clear` — reset the conversation.
- `/model [number|name]` — switch model (no argument opens a menu).
- `/plan [number]` — list or run a saved plan.
- `/plan-mode [on|off]` — toggle plan mode (no argument opens a menu).
- `/thinking [on|off]` — toggle model thinking (no argument opens a menu).
- `/show-thinking [on|off]` — toggle streaming of the thinking text.
- `/verbose [on|off]` — toggle full, untruncated tool output.
- `/skills` — list skills available from `.sup/skills`.
- `/exit` — quit (Ctrl+D / Ctrl+C also work).

## Configuration

All settings come from `.env`, each with a sensible default. The main ones:

- `MODEL`, `LANGUAGE`, `HOST` — Ollama target and reply language.
- `USE_PLAN_MODE` (on) — investigate with read-only tools, then propose a plan for approval before anything mutates.
- `USE_AUTONOMOUS_MODE` (on) — after approval, run up to `AUTONOMOUS_STEP_BUDGET` tool calls without prompting. Set `false` to confirm each call.
- `USE_SHELL_TOOL` (off) — register the `run_shell` tool.
- `USE_PERMISSION_ALLOWLIST` — shell commands matching `AUTO_APPROVE_SHELL_PATTERNS` (in `src/config.ts`) skip the confirm-prompt.

See `.env.example` for the full list.

## Plans

With `USE_PLAN_MODE` on, the model reads the relevant files, writes a Markdown plan, and waits for your `y / n / feedback`. Approved plans are saved to `.sup/plans/` and survive across sessions — load one later with `/plan`, no re-approval. Add `.sup/` to `.gitignore` to keep them untracked.

## Skills

Skills are reusable, on-demand instruction sets for specific tasks (like Claude Code skills). Each lives in its own folder `.sup/skills/<name>/SKILL.md`, with YAML frontmatter and a Markdown body:

```markdown
---
name: git-review
description: Review a git diff before committing — what to check and how to describe changes.
---

<full instructions; may reference sibling files placed next to SKILL.md>
```

Only each skill's name and `description` go into the system prompt (cheap on context). When a task matches, the model calls the `skill` tool to load the full `SKILL.md` body, then follows it — it can `read_file` any sibling files bundled in the skill folder. Skills are discovered once at startup, like `AGENTS.md`. List them with `/skills`.

## Project instructions

If `AGENTS.md` is present in the working directory, it is appended to the system prompt at startup.

## Security

- Read-only tools (`read_file`, `glob`, `grep`) run without confirmation, scoped to the working directory.
- Mutating (`write_file`, `edit_file`, `run_shell`) and network (`web_search`, `fetch_url`) tools require a `[y / n / feedback]` prompt — unless autonomous mode is on (you approve the plan once) or a shell command matches the allowlist.
