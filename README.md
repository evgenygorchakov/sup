# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Inspired by Claude Code and [a5c-ai/babysitter](https://github.com/a5c-ai/babysitter).

I've only tested it with models in the 27–35B range — nothing larger.

## Setup

Requires Node.js 24+ (the CLI runs its TypeScript sources directly, no build step).

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`). Leave `MODEL` empty and it is taken from the server at startup — the most recently pulled Ollama model; llama.cpp always serves the single model it was started with.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan / auto / thinking / verbose output, list saved plans, clear history; `Shift+Tab` cycles the mode in place.
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed to keep the context short.
- A response that degenerates into repeating itself is cut mid-stream, trimmed to a single cycle, and the model is told why (`USE_LOOP_DETECTION`); thinking longer than `THINKING_CHAR_LIMIT` characters is stopped the same way.
- The `web_search` tool needs `OLLAMA_API_KEY` from [ollama.com/settings/keys](https://ollama.com/settings/keys); everything else works without it.
- Models without native tool calling fall back to prompt-engineered tools (`USE_NATIVE_TOOLS=false`).
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- Defaults to Ollama; `sup --llama` (or `sup --provider <name>`) switches for a single run without touching `.env`.
- `AGENTS.md` in the working directory is appended to the system prompt, and `sup --no-system-prompt` drops the system prompt entirely (role, workflow, skills, `AGENTS.md`) for probing a research model's raw behavior.
- `REPLY_STYLE_SHORT` sets the style, with or without speech: `true` (default) is terse, 1-3 lines; `false` is conversational.
- Skills: Claude Code ones load as-is, from `.sup/skills` and callable as `/<skill-name>`; see [Skills](#skills).
- Paste an image from the clipboard.
- Drag a PDF into the terminal and it becomes a markdown file — see [PDF](#pdf).
- Talk to it instead of typing — see [Voice](#voice).

## Skills

Claude Code skills load as-is — same `SKILL.md` convention, multi-line `description: >-` parsed, unknown frontmatter fields ignored. What differs:

- They are read from `.sup/skills` in the directory you run sup in, so every project brings its own; `USE_CLAUDE_SKILLS=true` also picks up `.claude/skills` there, with `.sup/skills` winning a name collision.
- Tools go by sup's names: `Read` → `read_file`, `Bash` → `run_shell`, `WebFetch` → `fetch_url`, plus `write_file`, `edit_file`, `grep`, `glob`, `web_search`.
- `$ARGUMENTS`, `allowed-tools`, hooks, and subagents don't exist here and are ignored, so strip them.
- Bundled files, subfolders included, are listed to the model automatically, so the body doesn't have to point at them.
- A small model rarely notices "this task matches a skill", so you can force one: `/skills` lists them, `/skills <number|name> [task]` loads one, and every skill is also its own command (`/aif-commit only staged files`) unless a built-in command has the same name.
- Shorten aggressively — one procedure, imperative steps, concrete commands, no branching like "if X, see references/y.md"; what a frontier model follows is usually too long and too branchy for a <30B one.

### Steps and Verification

Two headings mean more than prose to the [babysitter](src/babysitter/README.md) (needs `USE_BABYSITTER=true`; `BABYSITTER_GATED_SKILLS` is on by default), which turns them into an enforced checklist and a finish gate:

```markdown
## Steps

1. [x] Bump the version in package.json.
2. Commit, tag `v<version>`, and run `npm publish`.

## Verification

- `npm run lint`
```

- Every list item under `## Steps` becomes a ledger step the model ticks off with `ledger_update`, bullets included — keep notes and rules under their own heading.
- `- [x]` marks a step as already done, so an interrupted run resumes where it stopped; tick them all and the skill only runs its verification.
- `## Verification` commands have to pass before the model may finish, and are read from inline code, `$`-prefixed lines, or fenced blocks.
- Such a command must start with a known runner (`npm`, `git`, `pytest`, `cargo`, … — `RUNNER_COMMAND` in `src/babysitter/parse-sections.ts`) and carry no shell metacharacters, so `&&` and pipes are skipped.
- Russian headings (`## Шаги`, `## Проверка`) work, as does a bold `**Steps**` line instead of a real heading.

## Voice

Speech in and out, both through local servers, so nothing leaves the machine. The servers themselves live outside this app — their scripts, systemd units, and a from-scratch setup guide (in Russian) are in [`voice-servers/`](voice-servers/README.md).

- Dictation is on by default: `Ctrl+G` records, then `Enter` sends what you said, `Ctrl+G` inserts it without sending, `Esc` drops it — `/stt` mid-session or `USE_STT=false` at startup turns it off.
- Whatever text sits in the clipboard is glued to the end of what you dictate, so "let's read this article" carries the link you just copied — and a copied link arrives with the instruction to open it through `fetch_url` instead of inventing the page; anything else arrives as a quoted block, cut at `CLIPBOARD_MAX_CHARS`.
- The attachment shows up in the line as `[clipboard #1: …]`, so deleting the marker before sending drops it; the same clipboard is never attached twice in a row, and `/clipboard` mid-session (or `USE_DICTATION_CLIPBOARD=false`) turns this off.
- Audio is captured with `parecord` and transcribed by a local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) server; how it is wired is in [`src/stt/README.md`](src/stt/README.md) (in Russian).
- Text to speech is off by default (`/tts` mid-session, or `USE_TTS=true` at startup) and speaks the final answer through [Silero v5](https://github.com/snakers4/silero-models); `TTS_VOICE` picks one of the five Russian voices and `TTS_RATE` the pace (`x-slow` … `x-fast`, default `medium`).
- Thinking, tool output, proposed plans, and the report after an interrupted turn stay silent — they are written for the screen, paths and identifiers included — as do code blocks and tables.
- While speech is on, each request carries a spoken-style reminder: no markdown, no dictated paths, numbers as words. Length is `REPLY_STYLE_SHORT`, not a speech setting.
- `Esc` cuts the voice, during the request or at the prompt afterwards, as does sending the next one; a TTS server that stops answering turns speech off by itself.

## PDF

Drag a PDF into the terminal, press `Enter`, and it is converted to markdown — and that is the whole effect: the `.md` lands in the directory you are working in and nothing goes to the model. The converter is [marker](https://github.com/datalab-to/marker) in its own venv, run on demand — no daemon, nothing leaves the machine. Setup is in [`converters/marker/`](converters/marker/README.md) (in Russian); until it is installed, a dropped PDF stays a plain path and `sup` says so once.

- A drop of nothing but PDFs converts them and returns you to the prompt: no request is sent, the context stays as it was. Ask about the `.md` afterwards and the model reads it with `read_file` like any other file.
- A path inside a sentence — "have a look at ~/Downloads/report.pdf" — keeps the sentence and becomes the path of the markdown, so the model knows what to read. Windows paths from a WSL drop are translated the same way image paths are.
- Dropping the same PDF again is instant: an `.md` newer than its PDF is reused instead of running the converter. An older one is overwritten.
- `/pdf <path>` converts without a drop, `/pdf off` turns the automatic conversion off, `PDF_EXTRACT_IMAGES=true` also writes the pictures next to the `.md`.
- No daemon means every file reloads the models — tens of seconds on CPU before the pages even start, hence `PDF_TIMEOUT_MS` of 15 minutes.

## Run journal

On by default (`USE_JOURNAL=true`; independent of the babysitter). Every run is journaled as an event log at `.sup/runs/<id>/journal.jsonl` — the user requests, the model's replies, and every tool call and result. A failed write never interrupts the work.

This is what powers `sup --resume` (or `sup --resume=<run-id>` for a specific run): it loads the journal from the current directory, restores the dialog, and continues where you left off. If the babysitter was active, the step ledger is restored too.

## Babysitter mode

Deterministic harness-side control that keeps the model on its checklist and verifies "all done" before accepting it. Off by default (`USE_BABYSITTER=true`) — see [`src/babysitter/README.md`](src/babysitter/README.md).

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Starts in auto mode, so edits (`write_file`/`edit_file`) run unattended while non-allowlisted shell commands still ask `[y / n / type feedback]`; `USE_AUTO_MODE=false` starts in normal mode, where edits ask too.
- Network tools (`fetch_url`/`web_search`) run without confirmation.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
- `sup --dangerously-skip-permissions` bypasses every approval prompt for the whole session — only use it when you trust the model and the working directory.
