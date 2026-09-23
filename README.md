# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Inspired by Claude Code. Only tested with models in the 27–35B range.

## Setup

Requires Node.js 24+ (the CLI runs its TypeScript sources directly, no build step).

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`). Leave `MODEL` empty and it is taken from the server at startup.
3. `npm link`, then run `sup` in any directory.

Every setting is an `.env` variable with a sane default — see [`.env.example`](.env.example). `sup --llama` (or `sup --provider <name>`) switches provider for a single run.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Starts in auto mode, so edits (`write_file`/`edit_file`), `fetch_url` and `web_search` run unattended while non-allowlisted shell commands still ask `[y / n / type feedback]`; `USE_AUTO_MODE=false` starts in normal mode, where those ask too. Read-only tools (`read_file`, `grep`, `glob`) never ask.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
- `sup --dangerously-skip-permissions` bypasses every approval prompt for the whole session — only use it when you trust the model and the working directory.
