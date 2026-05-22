# Agent

A minimal local CLI assistant. It sends a prompt to a local [Ollama](https://ollama.com) model, lets it propose shell commands, explains what it will do, asks for confirmation before running, and loops until the task is complete.

## Setup

1. Install and launch [Ollama](https://ollama.com).
2. Download a model.
3. Clone the repository and open the project.
4. Copy `.env.example` to `.env` and set at least `MODEL`. `web_search` also needs `OLLAMA_API_KEY` from [ollama.com](https://ollama.com).
5. `npm link` — makes the `sup` command available globally. Run `sup` in any directory to start the agent.

## Slash commands

During a session, lines starting with `/` are commands instead of prompts:

- `/help` — list available commands.
- `/clear` — clear the conversation history (keeps the system prompt).
- `/exit` — quit the session (Ctrl+D and Ctrl+C also work).

## Configuration

All settings are read from `.env` at startup. Copy `.env.example` to `.env` and uncomment what you need — every key falls back to a sensible default if left unset.

- `MODEL`, `LANGUAGE`, `HOST` — Ollama target and reply language.
- `USE_RESEARCH_MODE` — read-only session: `write_file`, `edit_file`, `run_shell` are removed from the tool registry; only `read_file`, `grep`, `glob`, `web_search`, `fetch_url` remain.
- `USE_PLAN_MODE` — adds an explicit plan-approval step before any tool calls.
- `USE_AUTONOMOUS_MODE` — disables every confirm-prompt and runs up to `AUTONOMOUS_STEP_BUDGET` tool calls without asking. Use deliberately.
- `USE_NATIVE_OLLAMA_TOOLS` — switches between native Ollama tool-calls and prompt-based tool-calls.
- `USE_PERMISSION_ALLOWLIST` — shell commands matching the allowlist skip the confirm-prompt. The allowlist itself (`AUTO_APPROVE_SHELL_PATTERNS`, e.g. `ls`, `pwd`, `git status`, …) lives in `src/config.ts`; anything containing shell metacharacters (`;`, `|`, `&`, `<`, `>`, backtick, `$`, newline) is never auto-approved.

See `.env.example` for the full list, including tool limits and Ollama-specific options.

## Project instructions

If `AGENTS.md` is present in the working directory it is loaded automatically and appended to the system prompt at startup.

## Pros

- Zero runtime dependencies.
- Every command is shown and explained before execution.
- Rejection becomes a conversation — provide feedback and the model will replan.

## Security

- Local read-only tools (`read_file`, `glob`, `grep`) run without confirmation. They are scoped to the current working directory.
- Network tools (`web_search`, `fetch_url`) and any mutating tool (`write_file`, `edit_file`, `run_shell`) require a `[y / n / type feedback]` prompt before each call.
- Shell commands matching `AUTO_APPROVE_SHELL_PATTERNS` are auto-approved; everything else waits for confirmation.
- `USE_AUTONOMOUS_MODE` removes every prompt — only enable it when you accept that.
