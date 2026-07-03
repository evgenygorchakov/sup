# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Inspired by Claude Code and [a5c-ai/babysitter](https://github.com/a5c-ai/babysitter).

I've only tested it with models in the 27–35B range — nothing larger.

## Setup

Requires Node.js 24+ (the CLI runs its TypeScript sources directly, no build step).

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`)/`MODEL`.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan / auto / thinking / verbose output, list saved plans, clear history.
- Three modes, like Claude Code; `Shift+Tab` cycles them in place (the prompt indicator updates immediately):
  - **normal** — asks `[y / n / type feedback]` before mutating edits (`write_file`/`edit_file`) and before non-allowlisted shell commands.
  - **auto** (`[auto]`) — auto-approves edits without asking; shell still goes through the read-only allowlist (anything else still asks).
  - **plan** (`[plan]`) — read-only investigation, then a Markdown plan: approve with `y` (edits still ask one by one), `a` (approve and auto-approve edits, like auto mode), reject with `n` (the request is removed from history, so the next message starts clean), or type feedback to replan. `Esc` interrupts a plan that is still generating.
  - Pick the starting mode with `USE_PLAN_MODE` / `USE_AUTO_MODE`, or switch at runtime with `Shift+Tab`, `/plan-mode`, `/auto-mode`.
  - **`sup --read-only`** (or `USE_READ_ONLY_MODE=true`) — session-wide read-only: `write_file` / `edit_file` / `run_shell` are removed from the toolset entirely, so a small model has fewer tools to pick from and no way to mutate anything. The prompt shows `[read-only]`. This is a startup flag, not a fourth mode: the toolset and system prompt are fixed once per session, which keeps them consistent and the prompt-prefix cache warm.
  - **`--dangerously-skip-permissions`** — like Claude Code, bypasses every approval prompt for the whole session: edits and shell commands run without asking, regardless of mode or the shell allowlist. The prompt shows a red `[skip-perms]` indicator. Only use it when you trust the model and the working directory.
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed to keep the context short. Models without native tool calling fall back to prompt-engineered tools (`USE_NATIVE_TOOLS=false`).
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- Defaults to Ollama; switch to llama.cpp for a single run with `sup --llama` (or `sup --provider <name>`) without touching `.env`. The active provider and model are printed at startup.
- `AGENTS.md` in the working directory is appended to the system prompt.
- Skills (like Claude Code skills): reusable instructions in `.sup/skills`, loaded on demand — see [Skills](#skills).
- Paste an image from the clipboard

## Skills

Reusable instruction sets the model loads on demand, like Claude Code skills. Each skill is a folder in `.sup/skills` with a `SKILL.md`; the folder name is the skill name, and the frontmatter needs a `description`:

```markdown
---
description: Release a new version of the package to npm.
---

Cut a release from the current state of main.

## Steps

1. Run `npm run lint` and fix anything it reports.
2. Bump the version in package.json (patch unless the user says otherwise).
3. Commit, tag `v<version>`, and run `npm publish`.

## Verification

- `npm run lint`
- `git status --porcelain` prints nothing
```

How skills surface:

- Skill names and descriptions go into the system prompt; when the task matches, the model loads the full body with the `skill` tool.
- Small models are bad at noticing "this task matches a skill", so you can force one yourself: `/skills` lists them, `/skills <number|name> [task]` loads one into the conversation immediately.
- Other files in the skill folder (subfolders included, e.g. `references/checklist.md`) are listed to the model as readable with `read_file`.

Writing skills for small models:

- Keep them short, linear, and imperative: one procedure per skill, concrete commands over judgment calls, no branching like "if X, see references/y.md".
- Name the tools sup actually has — `read_file`, `write_file`, `edit_file`, `run_shell`, `grep`, `glob`, `web_search`, `fetch_url` — not another agent's tool names.
- Everything between `## Steps` and the next heading becomes a ledger step, bullet lists included — keep notes and rules under their own heading.
- A `## Steps` section with a numbered list unlocks [babysitter](#babysitter-mode) gating (needs `USE_BABYSITTER=true`; `BABYSITTER_GATED_SKILLS` is on by default): the steps become an enforced checklist the model ticks off with `ledger_update`. An optional `## Verification` section lists checks that must pass before the model may finish; commands are picked from inline code or fenced blocks and must start with a known runner (`npm`, `git`, `pytest`, `cargo`, ... — see `RUNNER_COMMAND` in `src/babysitter/parse-sections.ts`). Russian headings (`## Шаги`, `## Проверка`) work too.

Porting Claude Code skills: they load as-is — the frontmatter convention is the same, multi-line `description: >-` is supported, unknown fields are ignored. But treat them as drafts, not drop-ins: rename tools to sup's names (`Read` → `read_file`, `Bash` → `run_shell`, `WebFetch` → `fetch_url`), strip mechanics sup doesn't have (`$ARGUMENTS`, `allowed-tools`, hooks, subagents), and shorten aggressively — skills written for frontier models are usually too long and too branchy for a <30B model to follow.

## Run journal

On by default (`USE_JOURNAL=true`; independent of the babysitter). Every run is journaled as an event log at `.sup/runs/<id>/journal.jsonl` — the user requests, the model's replies, and every tool call and result. A failed write never interrupts the work.

This is what powers `sup --resume` (or `sup --resume=<run-id>` for a specific run): it loads the journal from the current directory, restores the dialog, and continues where you left off. If the babysitter was active, the step ledger is restored too.

## Babysitter mode

Think of the model as a junior intern who knows the job but keeps forgetting where it stopped, skips list items, and says "all done" without checking. Babysitter is the strict mentor standing behind its shoulder. Importantly, the mentor is not the model itself — it is the harness, deterministic code that keeps the model honest.

Off by default; enable with `USE_BABYSITTER=true`. It then does two things:

### The two jobs of Babysitter

1. **Keeps the checklist in front of the model.** When a new task starts (a plan is approved or a skill with steps is loaded), Babysitter takes the numbered steps and shows the checklist before every model reply: "Here are your tasks. Step 1 done? No? Then work on step 3, don't skip ahead." The model marks finished steps via the `ledger_update` tool, so it doesn't lose the thread.
2. **Doesn't take "all done" at face value.** When the model tries to finish, Babysitter checks whether the verification commands have actually run.
   * If the task has commands, Babysitter runs them itself. All green — the model may finish; otherwise Babysitter returns the failures and demands fixes.
   * If there are no commands, Babysitter asks the model to verify and won't accept "done" until a check has run. To avoid an endless loop it limits the attempts (3 by default), then gives up and allows the finish.

Its checklist and gate events are written to the [run journal](#run-journal), so an interrupted task can be resumed with the step ledger intact.

#### What a pass looks like

One pass of a task has four stages:

1. **Start.** The user gives a task or approves a plan. Babysitter builds the step list.
2. **Work loop.** Before each reply Babysitter shows the current checklist. The model does a step, calls tools (file edits, shell, etc.) and marks finished steps.
3. **Finish attempt.** When the model stops calling tools, Babysitter runs the verification gate.
4. **Fork.** If the gate fails, the loop continues. If it passes, Babysitter marks all steps done, clears the state, and returns the final answer.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Confirmation depends on the mode (see Usage above): in **normal** mode, edits (`write_file`/`edit_file`) and non-allowlisted shell commands ask `[y / n / type feedback]`; in **auto** mode, edits run unattended but shell still respects the allowlist. Network tools (`fetch_url`/`web_search`) run without confirmation. Shell commands matching the read-only allowlist in `src/config.ts` always run unattended; in plan mode those allowlisted commands are what's available during exploration.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
