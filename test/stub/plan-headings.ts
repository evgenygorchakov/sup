/** What plan mode prints while it works: the investigation gets its own heading, and «Proposed plan:»
 *  stands directly above the plan text instead of above the `read_file`/`glob` rounds that precede it.
 *  Run with: node test/run.ts (or node test/stub/plan-headings.ts); writes only into a temp directory. */
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { check, done } from '../lib/check.ts'

// Must be set before config.ts is evaluated, so every import below is dynamic.
Object.assign(process.env, {
  USE_JOURNAL: 'false',
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
// No terminal on stderr: no spinner frames and no ANSI codes in what the checks read back.
Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true })

const { mkdtemp, writeFile } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')

const { run } = await import('../../src/agent.ts')
const { clearActivePlan } = await import('../../src/plan/active-plan.ts')
const { setMode } = await import('../../src/plan/mode-state.ts')

type Message = import('../../src/types.ts').Message
type ChatProvider = import('../../src/providers/types.ts').ChatProvider
type OnStreamPart = import('../../src/ui/interactive/stream-printer.ts').OnStreamPart

const PLAN_FIRST_LINE = '## Context'
const PLAN = `${PLAN_FIRST_LINE}\ncalc.js adds only\n\n## Steps\n1. rewrite calc.js\n`
const NARRATION = 'One more file to check.'

const readline = { question: async () => 'y' } as unknown as import('node:readline/promises').Interface

function readCall(id: string): Message {
  return { role: 'assistant', content: '', tool_calls: [{ id, function: { name: 'read_file', arguments: { path: 'calc.js' } } }] }
}

/** Replies the way a real provider does: content reaches the screen token by token while the request
 *  is still open, which is what decides where a heading can be printed. */
function provider(replies: Message[], streaming: boolean): ChatProvider {
  let index = 0
  return {
    host: 'stub',
    chat: async (_messages, _tools, onStreamPart?: OnStreamPart) => {
      const reply = replies[Math.min(index, replies.length - 1)]!
      index += 1
      if (streaming && reply.content) {
        for (const chunk of reply.content.split(/(?<=\n)/)) {
          onStreamPart?.({ content: chunk })
        }
      }
      return structuredClone(reply)
    },
    initializeContextWindow: async () => {},
    getContextWindowTokenLimit: () => 80_000,
    listInstalledModels: async () => ({ ok: true, models: [] }),
    resolveDefaultModel: async () => null,
  }
}

/** Everything printed while `body` runs, with the spinner's carriage returns dropped. */
async function transcriptOf(body: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stderr.write

  try {
    await body()
  }
  finally {
    process.stderr.write = write
  }

  return chunks.join('')
}

/** The order in which the headings, the tool calls and the plan itself reached the screen. */
function shape(transcript: string): string[] {
  const markers: Record<string, string> = {
    'Investigating…': 'investigating',
    'Proposed plan:': 'heading',
    'read_file(': 'tool',
    [PLAN_FIRST_LINE]: 'plan',
    [NARRATION]: 'narration',
  }
  const pattern = new RegExp(Object.keys(markers).map(marker => marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return [...transcript.matchAll(pattern)].map(match => markers[match[0]]!)
}

const workDir = await mkdtemp(join(tmpdir(), 'sup-plan-headings-'))
process.chdir(workDir)
await writeFile('calc.js', 'export const add = (a, b) => a + b\n', 'utf8')

function userTurn(): Message[] {
  return [{ role: 'system', content: 'sys' }, { role: 'user', content: 'add division to calc.js' }]
}

// --- a streamed plan: investigation, prose the model slipped in before another tool call, the plan
setMode('plan')
const streamed = await transcriptOf(async () => {
  await run(provider([
    readCall('call-1'),
    { ...readCall('call-2'), content: NARRATION },
    { role: 'assistant', content: PLAN },
    { role: 'assistant', content: 'done' },
  ], true), userTurn(), readline)
})
clearActivePlan()

check('headings mark every section change', shape(streamed), [
  'investigating',
  'tool',
  'heading',
  'narration',
  'investigating',
  'tool',
  'heading',
  'plan',
])
check('the first tool call follows its heading with nothing in between', streamed.slice(streamed.indexOf('Investigating…') + 'Investigating…'.length, streamed.indexOf('read_file(')).trim(), '●')
check('the plan starts right below its heading', streamed.split('Proposed plan:').at(-1)?.trimStart().startsWith(PLAN_FIRST_LINE), true)

// --- and without streaming, where the whole reply is printed at once
setMode('plan')
const buffered = await transcriptOf(async () => {
  await run(provider([
    readCall('call-1'),
    { role: 'assistant', content: PLAN },
    { role: 'assistant', content: 'done' },
  ], false), userTurn(), readline)
})
clearActivePlan()

check('a non-streamed plan gets the same headings', shape(buffered), ['investigating', 'tool', 'heading', 'plan'])

setMode('normal')
done()
