/** Turn-level checks for src/agent.ts: neither the active plan nor the auto-approval granted with `a`
 *  may outlive the turn that runs the plan.
 *  Run with: node test/run.ts (or node test/stub/plan-turn.ts); writes nothing outside a temp directory. */
import process from 'node:process'
import { check, done } from '../lib/check.ts'

// Must be set before config.ts is evaluated, so every import below is dynamic.
Object.assign(process.env, {
  USE_JOURNAL: 'false',
  USE_BABYSITTER: 'false',
  USE_PLAN_MODE: 'false',
  USE_AUTO_MODE: 'false',
  USE_TTS: 'false',
  USE_STT: 'false',
  USE_CLAUDE_SKILLS: 'false',
  SHOW_THINKING: 'false',
})
// confirmToolCalls() refuses a call outright when there is no terminal to ask on,
// which is exactly the "Cancelled by user" exit these checks need.
Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

const { mkdtemp, writeFile } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const { run } = await import('../../src/agent.ts')
const { buildPlanReminder, clearActivePlan, setActivePlan } = await import('../../src/plan/active-plan.ts')
const { clearAutoElevation, elevateAutoForTurn, isAutoModeActive, setMode } = await import('../../src/plan/mode-state.ts')
const { RequestCancelledError } = await import('../../src/providers/cancel.ts')

type Message = import('../../src/types.ts').Message
type ChatProvider = import('../../src/providers/types.ts').ChatProvider

const PLAN = '## Steps\n1. rewrite calc.js\n\n## Verification\n- `node --check calc.js`\n'
const PLAN_MARKER = 'rewrite calc.js'

const readline = {} as import('node:readline/promises').Interface

function provider(replies: (Message | Error)[], seen: Message[][] = []): ChatProvider {
  let index = 0
  return {
    host: 'stub',
    chat: async (messages) => {
      seen.push(messages)
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

function editCall(): Message {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call-1', function: { name: 'edit_file', arguments: { path: 'calc.js', old_text: 'a', new_text: 'b' } } }],
  }
}

function userTurn(): Message[] {
  return [{ role: 'system', content: 'sys' }, { role: 'user', content: 'do the thing' }]
}

async function afterRun(replies: (Message | Error)[]): Promise<ReturnType<typeof buildPlanReminder>> {
  setMode('normal')
  setActivePlan(PLAN)
  await run(provider(replies), userTurn(), readline).catch(() => {})
  return buildPlanReminder()
}

const workDir = await mkdtemp(join(tmpdir(), 'sup-turn-'))
process.chdir(workDir)
await writeFile('calc.js', 'export const add = (a, b) => a + b\n', 'utf8')

// --- the plan is delivered while the turn is running
setMode('normal')
setActivePlan(PLAN)
const seen: Message[][] = []
await run(provider([
  { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: { path: 'calc.js' } } }] },
  { role: 'assistant', content: 'done' },
], seen), userTurn(), readline)
check('plan reminder rides along after a tool result', seen[1]?.at(-1)?.content.includes(PLAN_MARKER), true)
check('plan is cleared after a finished turn', buildPlanReminder(), null)

// --- every abnormal exit clears it too
check('plan is cleared after a cancelled tool call', await afterRun([editCall()]), null)
check('plan is cleared after a cut-off reply', await afterRun([{ role: 'assistant', content: 'x', cutOff: 'content-loop' }]), null)
check('plan is cleared after an interrupted request', await afterRun([new RequestCancelledError()]), null)

// --- and the next turn starts without it
setMode('normal')
setActivePlan(PLAN)
await run(provider([editCall()]), userTurn(), readline)
const nextTurn: Message[][] = []
await run(provider([
  { role: 'assistant', content: '', tool_calls: [{ id: 'call-2', function: { name: 'read_file', arguments: { path: 'calc.js' } } }] },
  { role: 'assistant', content: 'four lines' },
], nextTurn), [{ role: 'system', content: 'sys' }, { role: 'user', content: 'how many lines in calc.js?' }], readline)
check('cancelled plan does not reach the next turn', nextTurn[1]?.some(message => message.content.includes(PLAN_MARKER)), false)

// --- `a` at the plan prompt buys auto-approval for this turn only
clearActivePlan()
setMode('normal')
elevateAutoForTurn()
const elevated: Message[][] = []
await run(provider([editCall(), { role: 'assistant', content: 'done' }], elevated), userTurn(), readline)
check('the edit runs unattended while the task is elevated', elevated[1]?.at(-1)?.content.startsWith('Rejected by user'), false)
check('elevation is dropped after a finished turn', isAutoModeActive(), false)

setMode('normal')
elevateAutoForTurn()
await run(provider([new RequestCancelledError()]), userTurn(), readline).catch(() => {})
check('elevation is dropped after an interrupted turn', isAutoModeActive(), false)
clearAutoElevation()

clearActivePlan()
done()
