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
- Skills (like Claude Code skills): drop `.sup/skills/<name>/SKILL.md` with a `description` in the frontmatter (the skill name is the folder name); the body is loaded on demand via the `skill` tool.
- Paste an image from the clipboard

## Babysitter mode

Think of the model as a junior intern who knows the job but keeps forgetting where it stopped, skips list items, and says "all done" without checking. Babysitter is the strict mentor standing behind its shoulder. Importantly, the mentor is not the model itself — it is the harness, deterministic code that keeps the model honest.

Off by default; enable with `USE_BABYSITTER=true`. It then does four things:

### The four jobs of Babysitter

1. **Keeps the checklist in front of the model.** When a new task starts (a plan is approved or a skill with steps is loaded), Babysitter takes the numbered steps and shows the checklist before every model reply: "Here are your tasks. Step 1 done? No? Then work on step 3, don't skip ahead." The model marks finished steps via the `ledger_update` tool, so it doesn't lose the thread.
2. **Doesn't take "all done" at face value.** When the model tries to finish, Babysitter checks whether the verification commands have actually run.
   * If the task has commands, Babysitter runs them itself. All green — the model may finish; otherwise Babysitter returns the failures and demands fixes.
   * If there are no commands, Babysitter asks the model to verify and won't accept "done" until a check has run. To avoid an endless loop it limits the attempts (3 by default), then gives up and allows the finish.
3. **Keeps a journal.** Babysitter appends every action to a journal file: user requests, results, gate runs. A failed write never interrupts the work.
4. **Can pick up where it left off.** Thanks to the journal a task can be interrupted and resumed with `sup --resume` (or `sup --resume=<run-id>` for a specific run): it loads the journal, restores the dialog and the step ledger, and continues from the last step.

#### What a pass looks like

One pass of a task has four stages:

1. **Start.** The user gives a task or approves a plan. Babysitter journals the request and builds the step list.
2. **Work loop.** Before each reply Babysitter shows the current checklist. The model does a step, calls tools (file edits, shell, etc.) and marks finished steps. Every action is journaled.
3. **Finish attempt.** When the model stops calling tools, Babysitter runs the verification gate.
4. **Fork.** If the gate fails, the loop continues. If it passes, Babysitter marks all steps done, journals "finish", clears the state, and returns the final answer.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Confirmation depends on the mode (see Usage above): in **normal** mode, edits (`write_file`/`edit_file`) and non-allowlisted shell commands ask `[y / n / type feedback]`; in **auto** mode, edits run unattended but shell still respects the allowlist. Network tools (`fetch_url`/`web_search`) run without confirmation. Shell commands matching the read-only allowlist in `src/config.ts` always run unattended; in plan mode those allowlisted commands are what's available during exploration.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
