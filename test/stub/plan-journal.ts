/** Journal-level checks for plan mode: a rejected plan must leave nothing for `--resume` to restore,
 *  an approved one must reach the journal whole — request, plan and approval in that order, and a
 *  planning round cut short by Esc must leave memory and journal saying the same thing.
 *  Run with: node test/run.ts (or node test/stub/plan-journal.ts); writes only into a temp directory. */
import process from 'node:process'
import { check, done } from '../lib/check.ts'

// Must be set before config.ts is evaluated, so every import below is dynamic.
Object.assign(process.env, {
  USE_JOURNAL: 'true',
  USE_BABYSITTER: 'false',
  USE_PLAN_MODE: 'true',
  USE_AUTO_MODE: 'false',
  USE_TTS: 'false',
  USE_STT: 'false',
  USE_CLAUDE_SKILLS: 'false',
  SHOW_THINKING: 'false',
})
// The plan prompt is only offered on a terminal; the readline stub below is what answers it.
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

const { mkdtemp } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const { run } = await import('../../src/agent.ts')
const { listRuns, loadRunEvents, reconstructMessages } = await import('../../src/journal/index.ts')
const { clearActivePlan } = await import('../../src/plan/active-plan.ts')
const { setMode } = await import('../../src/plan/mode-state.ts')
const { RequestCancelledError } = await import('../../src/providers/cancel.ts')

type Message = import('../../src/types.ts').Message
type ChatProvider = import('../../src/providers/types.ts').ChatProvider

const PLAN = '## Steps\n1. rewrite calc.js\n\n## Verification\n- `node --check calc.js`\n'
const REJECTED_REQUEST = 'add division to calc.js'
const APPROVED_REQUEST = 'add multiplication to calc.js'
const INTERRUPTED_REQUEST = 'add exponentiation to calc.js'
const FEEDBACK = 'too long, cut it down'
const PLAN_MARKER = 'rewrite calc.js'

/** One answer to the `[y / a / n / feedback]` prompt per planning round; the last one repeats. */
let answers = ['n']
const readline = { question: async () => (answers.length > 1 ? answers.shift()! : answers[0]!) } as unknown as import('node:readline/promises').Interface

function provider(replies: (Message | Error)[]): ChatProvider {
  let index = 0
  return {
    host: 'stub',
    chat: async () => {
      const reply = replies[Math.min(index, replies.length - 1)]!
      index += 1
      if (reply instanceof Error) {
        throw reply
      }
      return structuredClone(reply)
    },
    initializeContextWindow: async () => {},
    getContextWindowTokenLimit: () => 80_000,
    listInstalledModels: async () => ({ ok: true, models: [] }),
    resolveDefaultModel: async () => null,
  }
}

function userTurn(request: string): Message[] {
  return [{ role: 'system', content: 'sys' }, { role: 'user', content: request }]
}

const events = () => loadRunEvents(listRuns().at(-1) ?? '')

const workDir = await mkdtemp(join(tmpdir(), 'sup-journal-'))
process.chdir(workDir)

// --- `n`: the request is dropped from memory, and it never made it to disk in the first place
setMode('plan')
answers = ['n']
const rejected = userTurn(REJECTED_REQUEST)
await run(provider([{ role: 'assistant', content: PLAN }]), rejected, readline)
check('a rejected plan takes the request out of memory', rejected.length, 1)
check('the run is journalled, the rejected request is not', events().map(event => event.type), ['run_start'])
check('nothing of the rejected request is on disk', JSON.stringify(events()).includes(REJECTED_REQUEST), false)

// --- `y`: the whole planning block lands in the journal at once, request first
setMode('plan')
answers = ['y']
const approved = userTurn(APPROVED_REQUEST)
await run(provider([{ role: 'assistant', content: PLAN }, { role: 'assistant', content: 'done' }]), approved, readline)
check('one run directory for both turns', listRuns().length, 1)
check('an approved plan is journalled whole', events().map(event => event.type), ['run_start', 'user', 'assistant', 'user', 'assistant', 'finish'])

const restored = reconstructMessages(events(), listRuns().at(-1) ?? '')
check('--resume restores the approved turn only', restored.map(message => message.role), ['user', 'assistant', 'user', 'assistant'])
check('starting from the approved request', restored[0]?.content, APPROVED_REQUEST)
check('and never brings the rejected one back', restored.some(message => message.content.includes(REJECTED_REQUEST)), false)

// --- Esc in the feedback loop: the draft and the feedback only ever exist on the planning copy of
//     the history, so an interrupted round leaves memory and journal saying the same thing — nothing.
const eventsBeforeInterrupt = events().length
setMode('plan')
answers = [FEEDBACK, 'n']
const interrupted = userTurn(INTERRUPTED_REQUEST)
const mark = interrupted.length - 1
let cancelled = false
try {
  await run(provider([{ role: 'assistant', content: PLAN }, new RequestCancelledError()]), interrupted, readline)
}
catch (error) {
  cancelled = error instanceof RequestCancelledError
}

check('Esc in the second planning round surfaces as a cancellation', cancelled, true)
// index.ts rolls the turn back only while nothing was added past the request; anything more and it
// keeps the turn with an "interrupted" note the journal never saw.
check('the interrupted round adds nothing past the request', interrupted.length, mark + 1)
check('the superseded draft is not left in memory', interrupted.some(message => String(message.content).includes(PLAN_MARKER)), false)
check('the feedback is not left in memory', interrupted.some(message => String(message.content).includes(FEEDBACK)), false)
check('the interrupted round writes nothing to the journal', events().length, eventsBeforeInterrupt)
check('nothing of the interrupted request reaches disk', JSON.stringify(events()).includes(INTERRUPTED_REQUEST), false)

clearActivePlan()
done()
