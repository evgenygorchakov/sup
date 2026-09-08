#!/usr/bin/env node
/** Measure what TEMPERATURE, REPEAT_PENALTY and repeat_last_n actually do to the model.
 *
 *     node test/bench/sampling.ts
 *     node test/bench/sampling.ts 4                     # runs per case, default 2
 *     MODEL=qwen3.8:27b-q8_0 node test/bench/sampling.ts
 *
 * Goes straight to /api/chat with OLLAMA_HOST and MODEL from .env, so the harness is out of the
 * picture and a case is exactly one set of sampling options. Two measurements:
 *
 * 1. How strong a penalty has to be before it changes anything — a repetition task the sampler
 *    cannot help but notice, swept over repeat_penalty at the default window, then the same
 *    penalty at an explicit 64 and at 256. Comparing a window against no window at all only says
 *    that a penalty was applied; comparing 64 against 256 is what separates penalty from window.
 * 2. What a penalty costs on tool arguments — copying a repetitive file body byte for byte
 *    through a write_file call, which is the shape edit_file and write_file actually carry.
 *    A case is scored by how many runs came back identical to what was asked for.
 *
 * On qwen3.8:27b-q8_0 every penalty from 1.0 to 1.5 gives byte-identical output at any window, and
 * 1.8 breaks down identically at 64 and at 256 — the reason .env.example ships no REPEAT_PENALTY.
 */
import process from 'node:process'
import { Config } from '../../src/config.ts'

interface ChatReply {
  message?: {
    content?: string
    tool_calls?: { function?: { name?: string, arguments?: unknown } }[]
  }
}

const repeats = Number(process.argv[2] ?? 2)

const writeFileTool = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Write text to a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Full file text' },
      },
      required: ['path', 'content'],
    },
  },
}

async function ask(prompt: string, options: Record<string, unknown>, tools?: unknown[]): Promise<ChatReply> {
  const response = await fetch(`${Config.OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Config.MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      tools,
      options,
    }),
  })

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
  }

  return await response.json() as ChatReply
}

const REPETITION_PROMPT = 'Write the word banana 60 times, separated by single spaces. Output nothing else.'

const repetitionCases: { penalty: number, window: number | null }[] = [
  { penalty: 1.0, window: null },
  { penalty: 1.1, window: null },
  { penalty: 1.3, window: null },
  { penalty: 1.5, window: null },
  { penalty: 1.8, window: null },
  { penalty: 1.8, window: 64 },
  { penalty: 1.8, window: 256 },
  { penalty: 1.1, window: 256 },
]

async function measurePenaltyThreshold(): Promise<void> {
  console.log('1. Какой штраф вообще что-то меняет — задача-ловушка, temperature 0\n')

  for (const { penalty, window } of repetitionCases) {
    const options: Record<string, unknown> = { temperature: 0, num_predict: 120, repeat_penalty: penalty }
    if (window !== null) {
      options.repeat_last_n = window
    }

    const reply = await ask(REPETITION_PROMPT, options)
    const text = reply.message?.content ?? ''
    const bananas = text.split('banana').length - 1
    const windowLabel = window === null ? 'дефолт' : String(window)
    console.log(`  penalty ${penalty.toFixed(1)}  окно ${windowLabel.padEnd(6)} ${String(bananas).padStart(3)} × banana  ${JSON.stringify(text.slice(0, 60))}`)
  }

  console.log()
}

function repetitiveBody(functions: number): string {
  return Array.from(
    { length: functions },
    (_unused, index) => `export function step${index + 1}(value) {\n  const result = value + ${index + 1}\n  return result\n}`,
  ).join('\n')
}

function copyPrompt(target: string): string {
  return [
    'Call write_file once with path "steps.js" and content exactly equal to the text between',
    'the markers, byte for byte, including every newline and every space of indentation.',
    'Do not add, drop or reorder anything.',
    '',
    `---BEGIN---\n${target}\n---END---`,
  ].join('\n')
}

function copiedContent(reply: ChatReply): string | null {
  const call = reply.message?.tool_calls?.[0]
  if (!call) {
    return null
  }

  const raw = call.function?.arguments
  let args: unknown = raw
  if (typeof raw === 'string') {
    try {
      args = JSON.parse(raw)
    }
    catch {
      return null
    }
  }

  const content = (args as { content?: unknown })?.content
  return typeof content === 'string' ? content : null
}

const copyCases: { label: string, options: Record<string, unknown> }[] = [
  { label: 'temp 0.2, штрафа нет', options: { temperature: 0.2 } },
  { label: 'temp 0.2, penalty 1.1 (дефолт sup)', options: { temperature: 0.2, repeat_penalty: 1.1 } },
  { label: 'temp 0.2, penalty 1.1, окно 512', options: { temperature: 0.2, repeat_penalty: 1.1, repeat_last_n: 512 } },
  { label: 'temp 0.2, penalty 1.3', options: { temperature: 0.2, repeat_penalty: 1.3 } },
  { label: 'temp 0.2, penalty 1.5', options: { temperature: 0.2, repeat_penalty: 1.5 } },
  { label: 'temp 1.0, штрафа нет (как в Modelfile)', options: { temperature: 1.0 } },
  { label: 'temp 1.0, penalty 1.1', options: { temperature: 1.0, repeat_penalty: 1.1 } },
]

async function measureCopy(functions: number): Promise<void> {
  const target = repetitiveBody(functions)
  const prompt = copyPrompt(target)
  const wantedLines = target.split('\n')

  console.log(`2. Копирование в аргумент tool call — ${functions} функций, ${target.length} символов, ${repeats} прогона на случай\n`)

  for (const { label, options } of copyCases) {
    let exact = 0
    const notes: string[] = []

    for (let run = 0; run < repeats; run += 1) {
      const content = copiedContent(await ask(prompt, { num_predict: 2000, ...options }, [writeFileTool]))

      if (content === null) {
        notes.push('вызова нет или аргументы не разобрались')
        continue
      }
      if (content.trim() === target.trim()) {
        exact += 1
        continue
      }

      const gotLines = content.trim().split('\n')
      const lost = wantedLines.filter(line => !gotLines.includes(line))
      notes.push(`${gotLines.length}/${wantedLines.length} строк, потеряно ${lost.length}: ${JSON.stringify(lost.slice(0, 2))}`)
    }

    console.log(`  ${label.padEnd(38)} ${exact}/${repeats} точных`)
    for (const note of notes) {
      console.log(`  ${' '.repeat(38)} ${note}`)
    }
  }

  console.log()
}

console.log(`${Config.OLLAMA_HOST} · ${Config.MODEL}\n`)

await measurePenaltyThreshold()
await measureCopy(5)
await measureCopy(15)
