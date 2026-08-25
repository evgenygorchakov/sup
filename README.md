# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Inspired by Claude Code and [a5c-ai/babysitter](https://github.com/a5c-ai/babysitter). Only tested with models in the 27–35B range.

## Setup

Requires Node.js 24+ (the CLI runs its TypeScript sources directly, no build step).

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`). Leave `MODEL` empty and it is taken from the server at startup.
3. `npm link`, then run `sup` in any directory.

Every setting is an `.env` variable with a sane default — see [`.env.example`](.env.example). `sup --llama` (or `sup --provider <name>`) switches provider for a single run.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan / auto / thinking / verbose output, list saved plans, clear history; `Shift+Tab` cycles the mode in place.
- Plan mode investigates first and shows the plan for approval: `y` executes it in whatever mode the session was in before planning, `a` additionally auto-approves the edits of that one task without switching the session to auto, `n` drops the plan.
- `ask_user` (on by default, `USE_ASK_USER=false` turns it off) is how the model stops mid-task and puts one multiple-choice question to you, answered with the arrow keys; `Esc` dismisses it and the model decides for itself. When a question is allowed is decided by the harness, not the prompt: at least two investigation calls first, one question per turn, and none at all while planning. A refusal comes back as the tool result and says what to do instead — read the code, or state the assumption and carry on. Every question ships 2–4 concrete options, which is the real filter: a model that cannot name two alternatives does not have a question.
- The model has to support native tool calling — sup only ever goes through the provider's tools API. `web_search` additionally needs `OLLAMA_API_KEY` from [ollama.com/settings/keys](https://ollama.com/settings/keys).
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed.
- A response that degenerates into repeating itself is cut mid-stream, trimmed to a single cycle, and the model is told why (`USE_LOOP_DETECTION`); overlong thinking is stopped the same way (`THINKING_CHAR_LIMIT`).
- `AGENTS.md` in the working directory is appended to the system prompt; `sup --no-system-prompt` drops the system prompt entirely, for probing a research model's raw behavior.
- Paste an image from the clipboard.
- Two features need a separate install and are off by default — converting a dropped PDF to markdown and talking to sup instead of typing; both live in [`optional/`](optional/README.md), see [PDF](#pdf) and [Voice](#voice).

## Skills

Claude Code skills load as-is — same `SKILL.md` convention, multi-line `description: >-` parsed, unknown frontmatter fields ignored. What differs:

- They are read from `.sup/skills` in the directory you run sup in, so every project brings its own; `USE_CLAUDE_SKILLS=true` also picks up `.claude/skills` there, with `.sup/skills` winning a name collision.
- Tools go by sup's names: `Read` → `read_file`, `Bash` → `run_shell`, `WebFetch` → `fetch_url`, plus `write_file`, `edit_file`, `grep`, `glob`, `web_search`.
- `$ARGUMENTS`, `allowed-tools`, hooks, and subagents don't exist here and are ignored, so strip them.
- Bundled files, subfolders included, are listed to the model automatically, so the body doesn't have to point at them.
- A small model rarely notices "this task matches a skill", so you can force one: `/skills` lists them, `/skills <number|name> [task]` loads one, and every skill is also its own command (`/aif-commit only staged files`) unless a built-in command has the same name.
- Shorten aggressively — one procedure, imperative steps, concrete commands, no branching like "if X, see references/y.md"; what a frontier model follows is usually too long and too branchy for a <30B one.
- A `## Steps` list becomes an enforced checklist and `## Verification` commands a finish gate — see [Skills with steps](src/babysitter/README.md#skills-with-steps).

## Voice

Speech in and out, both through local servers, so nothing leaves the machine. Off by default, because the servers themselves live outside this app — setup is in [`optional/voice/`](optional/voice/README.md).

- Dictation (`USE_STT=true`, or `/stt` mid-session): `Ctrl+G` records, then `Enter` sends what you said, `Ctrl+G` inserts it without sending, `Esc` drops it. Audio is captured with `parecord` and transcribed by a local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) server ([details](src/stt/README.md), in Russian).
- Whatever text sits in the clipboard is glued to the end of what you dictate, so "let's read this article" carries the link you just copied. It shows up in the line as `[clipboard #1: …]`, so deleting the marker drops it; `/clipboard` (or `USE_DICTATION_CLIPBOARD=false`) turns this off.
- Text to speech (`USE_TTS=true`, or `/tts` mid-session) speaks the final answer through [Silero v5](https://github.com/snakers4/silero-models); `TTS_VOICE` and `TTS_RATE` pick the voice and the pace. Thinking, tool output, proposed plans, code blocks and tables stay silent — they are written for the screen.
- While speech is on, the system prompt swaps its terse `# Style` section for a conversational one and each request carries a spoken-style reminder: no markdown, no dictated paths, numbers as words. Toggling `/tts` mid-session takes effect from the next request on.
- `Esc` cuts the voice, during the request or at the prompt afterwards, as does sending the next one; a TTS server that stops answering turns speech off by itself.

## PDF

Drag a PDF into the terminal, press `Enter`, and it is converted to markdown — and that is the whole effect: the `.md` lands in the directory you are working in and nothing goes to the model. The converter is [marker](https://github.com/datalab-to/marker) in its own venv, run on demand. Off by default: install it first — setup is in [`optional/pdf/`](optional/pdf/README.md) — then start with `USE_PDF_CONVERT=true` or turn it on with `/pdf on`.

- A drop of nothing but PDFs converts them and returns you to the prompt: no request is sent, the context stays as it was. Ask about the `.md` afterwards and the model reads it with `read_file` like any other file.
- A path inside a sentence — "have a look at ~/Downloads/report.pdf" — keeps the sentence and becomes the path of the markdown, so the model knows what to read.
- An `.md` newer than its PDF is reused instead of running the converter again; an older one is overwritten. `/pdf <path>` converts without a drop, `/pdf on|off` flips the automatic conversion.
- No daemon means every file reloads the models — tens of seconds on CPU before the pages even start, hence `PDF_TIMEOUT_MS` of 15 minutes.

## Run journal

Off by default (`USE_JOURNAL=false`): the journal lives in the working directory, so unless `.sup/` is
gitignored, `grep` and `glob` find it and the model reads its own past dialogs as if they were project files.

With `USE_JOURNAL=true` every run is journaled as an event log at `.sup/runs/<id>/journal.jsonl` — the user
requests, the model's replies, and every tool call and result. A failed write never interrupts the work.

The journal is what powers `sup --resume` (or `sup --resume=<run-id>` for a specific run): it loads the journal from the current directory, restores the dialog, and continues where you left off — with the babysitter's step ledger, if it was active.

A request waiting for plan approval is journaled only once you approve the plan, together with the plan itself: reject it and nothing of that turn is left for `--resume` to bring back.

## Babysitter mode

Deterministic harness-side control that keeps the model on its checklist and verifies "all done" before accepting it. Off by default (`USE_BABYSITTER=true`) — see [`src/babysitter/README.md`](src/babysitter/README.md).

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Starts in auto mode, so edits (`write_file`/`edit_file`), `fetch_url` and `web_search` run unattended while non-allowlisted shell commands still ask `[y / n / type feedback]`; `USE_AUTO_MODE=false` starts in normal mode, where those ask too. Read-only tools (`read_file`, `grep`, `glob`) never ask.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
- `sup --dangerously-skip-permissions` bypasses every approval prompt for the whole session — only use it when you trust the model and the working directory.
