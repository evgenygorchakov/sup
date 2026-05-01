# Agent

A minimal local CLI assistant. It sends a prompt to a local [Ollama](https://ollama.com) model, lets it propose shell commands, explains what it will do, asks for confirmation before running, and loops until the task is complete.

## Setup

1. Install and launch [Ollama](https://ollama.com).
2. Download a model.
3. Clone the repository and open the project.
4. Pick a model in `src/config.ts` (`Config.MODEL`).
5. Optional: copy `.env.example` to `.env`. `web_search` requires `OLLAMA_API_KEY` from [ollama.com](https://ollama.com).
6. `npm link`

## Usage. For example model: qwen3.6 with thinking high mode:
https://github.com/user-attachments/assets/ef41b487-df7d-4b33-a0af-47c0d67cbfb1

## Configuration

All flags live in `src/config.ts`:

- `MODEL`, `LANGUAGE`, `HOST` — Ollama target and reply language.
- `USE_RESEARCH_MODE` — read-only session: `write_file`, `edit_file`, `run_shell` are removed from the tool registry; only `read_file`, `grep`, `glob`, `web_search`, `fetch_url` remain.
- `USE_PLAN_MODE` — adds an explicit plan-approval step before any tool calls.
- `USE_AUTONOMOUS_MODE` — disables every confirm-prompt and runs up to `AUTONOMOUS_STEP_BUDGET` tool calls without asking. Use deliberately.
- `USE_NATIVE_OLLAMA_TOOLS` — switches between native Ollama tool-calls and prompt-based tool-calls.
- `USE_PERMISSION_ALLOWLIST` + `AUTO_APPROVE_SHELL_PATTERNS` — shell commands matching the allowlist (`ls`, `pwd`, `git status`, …) skip the confirm-prompt. Anything containing shell metacharacters (`;`, `|`, `&`, `<`, `>`, backtick, `$`, newline) is never auto-approved.

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

**Read every command before approving.**
