/** Plan mode must not throw away what it read: the investigation behind an approved plan reaches the
 *  turn that executes it, the journal, and the second planning round after feedback — so the same
 *  files are not read twice. Superseded drafts and the feedback itself stay out of the main history.
 *  Run with: node test/run.ts (or node test/stub/plan-investigation.ts); writes only into a temp directory. */
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

const { mkdtemp, writeFile } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const { run } = await import('../../src/agent.ts')
const { listRuns, loadRunEvents, reconstructMessages } = await import('../../src/journal/index.ts')
const { clearActivePlan } = await import('../../src/plan/active-plan.ts')
const { setMode } = await import('../../src/plan/mode-state.ts')

type Message = import('../../src/types.ts').Message
type ChatProvider = import('../../src/providers/types.ts').ChatProvider

const FILE_MARKER = 'divide-by-zero-guard'
const REQUEST = 'add division to calc.js'
const FEEDBACK = 'return null instead of throwing'
const DRAFT_PLAN = '## Steps\n1. draft: throw on division by zero\n'
const FINAL_PLAN = '## Steps\n1. final: return null on division by zero\n\n## Verification\n- `node --check calc.js`\n'

const answers = [FEEDBACK, 'y']
const readline = { question: async () => answers.shift() ?? 'y' } as unknown as import('node:readline/promises').Interface

const seen: Message[][] = []

function provider(replies: Message[]): ChatProvider {
  let index = 0
  return {
    host: 'stub',
    chat: async (messages) => {
      seen.push(structuredClone(messages))
      const reply = replies[Math.min(index, replies.length - 1)]!
      index += 1
      return structuredClone(reply)
    },
    initializeContextWindow: async () => {},
    getContextWindowTokenLimit: () => 80_000,
    listInstalledModels: async () => ({ ok: true, models: [] }),
    resolveDefaultModel: async () => null,
  }
}

const readCall: Message = {
  role: 'assistant',
  content: '',
  tool_calls: [{ id: 'call-1', function: { name: 'read_file', arguments: { path: 'calc.js' } } }],
}

const workDir = await mkdtemp(join(tmpdir(), 'sup-plan-investigation-'))
process.chdir(workDir)
await writeFile('calc.js', `export const add = (a, b) => a + b // ${FILE_MARKER}\n`, 'utf8')

// Planning reads calc.js, drafts a plan, takes feedback, plans again, and only then is approved.
const messages: Message[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: REQUEST }]
setMode('plan')
await run(provider([
  readCall,
  { role: 'assistant', content: DRAFT_PLAN },
  { role: 'assistant', content: FINAL_PLAN },
  { role: 'assistant', content: 'done' },
]), messages, readline)

const [, , secondRound, execution] = seen

// --- the second planning round continues the first one instead of exploring anew
check('feedback round keeps the tool result', secondRound?.some(message => message.role === 'tool' && message.content.includes(FILE_MARKER)), true)
check('feedback round asks for a revision', secondRound?.at(-1)?.content.includes(FEEDBACK), true)
check('the file is read exactly once', secondRound?.filter(message => message.role === 'tool').length, 1)

// --- the approved turn executes with the investigation in front of it
check('the executing turn gets the investigation', execution?.some(message => message.role === 'tool' && message.content.includes(FILE_MARKER)), true)
check('history: request, investigation, plan, approval, answer', messages.map(message => message.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user', 'assistant'])
check('the tool call is paired with its result', messages[2]?.tool_calls?.[0]?.id, messages[3]?.tool_call_id)
check('the approved plan is the final one', messages[4]?.content, FINAL_PLAN)
check('the superseded draft is gone', messages.some(message => message.content.includes('draft:')), false)
check('the feedback stays in the planning conversation', messages.some(message => message.content.includes(FEEDBACK)), false)

// --- and the journal records it the way a normal turn does, so `--resume` restores it
const runId = listRuns().at(-1) ?? ''
const events = loadRunEvents(runId)
check('the investigation is journalled whole', events.map(event => event.type), ['run_start', 'user', 'assistant', 'tool_call', 'tool_result', 'assistant', 'user', 'assistant', 'finish'])
check('the tool result is named', events.find(event => event.type === 'tool_result')?.name, 'read_file')

const restored = reconstructMessages(events, runId)
check('--resume restores the investigation', restored.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'user', 'assistant'])
check('with the pairing intact', restored[1]?.tool_calls?.[0]?.id, restored[2]?.tool_call_id)
check('and the file content still in it', restored[2]?.content.includes(FILE_MARKER), true)

clearActivePlan()
done()
