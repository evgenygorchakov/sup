import process from 'node:process'
import { check, done } from '../lib/check.ts'

Object.assign(process.env, {
  USE_ASK_USER: 'true',
  USE_JOURNAL: 'false',
  USE_BABYSITTER: 'false',
  USE_PLAN_MODE: 'false',
  USE_AUTO_MODE: 'true',
  USE_TTS: 'false',
  USE_STT: 'false',
  USE_CLAUDE_SKILLS: 'false',
  SHOW_THINKING: 'false',
})
Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })

const { mkdtemp, writeFile } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const { run } = await import('../../src/agent.ts')
const { checkAskGate } = await import('../../src/tools/ask-gate.ts')
const { toolDefinitions } = await import('../../src/tools/registry.ts')
const { setMode } = await import('../../src/plan/mode-state.ts')

type Message = import('../../src/types.ts').Message
type ToolDefinition = import('../../src/types.ts').ToolDefinition
type ChatProvider = import('../../src/providers/types.ts').ChatProvider

const readline = {} as import('node:readline/promises').Interface

function provider(replies: Message[], seen: Message[][] = [], offered: ToolDefinition[][] = []): ChatProvider {
  let index = 0
  return {
    host: 'stub',
    chat: async (messages, tools) => {
      seen.push(messages)
      offered.push(tools)
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

function readCall(id: string): Message {
  return { role: 'assistant', content: '', tool_calls: [{ id, function: { name: 'read_file', arguments: { path: 'calc.js' } } }] }
}

function askCall(question: string): Message {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'ask-1', function: { name: 'ask_user', arguments: { question, options: ['Named export', 'Default export'] } } }],
  }
}

function userTurn(text: string): Message[] {
  return [{ role: 'system', content: 'sys' }, { role: 'user', content: text }]
}

const lastToolResult = (messages: Message[]): string =>
  messages.filter(message => message.role === 'tool').at(-1)?.content ?? ''

const workDir = await mkdtemp(join(tmpdir(), 'sup-ask-'))
process.chdir(workDir)
await writeFile('calc.js', 'export const add = (a, b) => a + b\n', 'utf8')
setMode('auto')

check('ask_user is registered', toolDefinitions.some(definition => definition.function.name === 'ask_user'), true)

const early = userTurn('add a div function')
await run(provider([askCall('Named or default?'), { role: 'assistant', content: 'done' }]), early, readline)
check('an unearned question is refused', lastToolResult(early).startsWith('ERROR: refused by the harness'), true)
check('the refusal names the missing investigation', lastToolResult(early).includes('at least 2'), true)
check('and the turn goes on to finish', early.at(-1)?.content, 'done')

const earned = userTurn('add a div function')
await run(provider([readCall('r1'), readCall('r2'), askCall('Named or default?'), { role: 'assistant', content: 'done' }]), earned, readline)
check('an earned question passes the gate', lastToolResult(earned).includes('refused by the harness'), false)
check('a headless run is told to decide for itself', lastToolResult(earned).includes('Pick the option you think is right'), true)

check('the gate remembers the turn that just ran', checkAskGate(), null)
await run(provider([{ role: 'assistant', content: 'nothing to do' }]), userTurn('thanks'), readline)
check('a new turn starts the count again', checkAskGate()?.includes('investigated 0 time'), true)

// --- planning has no ask_user: it is never offered, and a call for it is refused before it runs
Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
const rejectPlan = { question: async () => 'n' } as unknown as import('node:readline/promises').Interface
setMode('plan')

const planSeen: Message[][] = []
const planTools: ToolDefinition[][] = []
const planning = userTurn('add a div function')
await run(
  provider([askCall('Named or default?'), { role: 'assistant', content: '## Steps\n1. add div\n' }], planSeen, planTools),
  planning,
  rejectPlan,
)

check('ask_user is not offered while planning', planTools[0]?.some(definition => definition.function.name === 'ask_user'), false)
check('a question asked while planning is refused', planSeen.at(-1)?.some(message => message.role === 'tool' && message.content.includes('available while planning')), true)
check('and the refusal never reaches the menu', planSeen.at(-1)?.some(message => message.role === 'tool' && message.content.includes('The user answered')), false)

// --- what the plan was built on is the executing turn's investigation, so it earns that turn its question
const approvePlan = { question: async () => 'y' } as unknown as import('node:readline/promises').Interface
setMode('plan')
await run(
  provider([readCall('p1'), readCall('p2'), { role: 'assistant', content: '## Steps\n1. add div\n' }, { role: 'assistant', content: 'done' }]),
  userTurn('add a div function'),
  approvePlan,
)
check('reading done while planning counts toward the gate', checkAskGate(), null)

done()
