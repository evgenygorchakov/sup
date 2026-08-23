# Babysitter mode

Think of the model as a junior intern who knows the job but keeps forgetting where it stopped, skips list items, and says "all done" without checking. Babysitter is the strict mentor standing behind its shoulder. Importantly, the mentor is not the model itself — it is the harness, deterministic code that keeps the model honest.

Off by default; enable with `USE_BABYSITTER=true`. It then does two things:

## The two jobs of Babysitter

1. **Keeps the checklist in front of the model.** When a new task starts (a plan is approved or a skill with steps is loaded), Babysitter takes the numbered steps and shows the checklist before every model reply: "Here are your tasks. Step 1 done? No? Then work on step 3, don't skip ahead." The model marks finished steps via the `ledger_update` tool, so it doesn't lose the thread.
2. **Doesn't take "all done" at face value.** When the model tries to finish, Babysitter checks whether the verification commands have actually run.
   * If the task has commands, Babysitter runs them itself. All green — the model may finish; otherwise Babysitter returns the failures and demands fixes.
   * If there are no commands, Babysitter asks the model to verify and won't accept "done" until a check has run. To avoid an endless loop it limits the attempts (3 by default), then gives up and allows the finish.

Its checklist and gate events are written to the [run journal](../../README.md#run-journal), so an interrupted task can be resumed with the step ledger intact.

## What a pass looks like

One pass of a task has four stages:

1. **Start.** The user gives a task or approves a plan. Babysitter builds the step list.
2. **Work loop.** Before each reply Babysitter shows the current checklist. The model does a step, calls tools (file edits, shell, etc.) and marks finished steps.
3. **Finish attempt.** When the model stops calling tools, Babysitter runs the verification gate.
4. **Fork.** If the gate fails, the loop continues. If it passes, Babysitter marks all steps done, clears the state, and returns the final answer.

## Settings

Each part can be turned off on its own — `BABYSITTER_LEDGER` (the checklist), `BABYSITTER_VERIFICATION_GATE` (the finish gate), `BABYSITTER_GATED_SKILLS` (gating for skills with a `## Steps` section), `BABYSITTER_GATE_MAX_ATTEMPTS`, `BABYSITTER_GATE_TIMEOUT_MS`; see the Babysitter section in [`.env.example`](../../.env.example).

## Skills with steps

A skill whose `SKILL.md` has these two headings is gated the same way (`BABYSITTER_GATED_SKILLS`, on by default): they become an enforced checklist and a finish gate.

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
- Such a command must start with a known runner (`npm`, `git`, `pytest`, `cargo`, … — `RUNNER_COMMAND` in [`parse-sections.ts`](parse-sections.ts)) and carry no shell metacharacters, so `&&` and pipes are skipped.
- Russian headings (`## Шаги`, `## Проверка`) work, as does a bold `**Steps**` line instead of a real heading.

See [Skills](../../README.md#skills) in the main README for how skills are loaded.
