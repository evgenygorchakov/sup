/** Ollama thinking: the mode comes from the model's own capabilities, not from a list of names.
 *  No Ollama — /api/show is a stubbed fetch. Run with: node test/run.ts (or node test/unit/thinking.ts). */
import { check, done } from '../lib/check.ts'
import { Config } from '../../src/config.ts'
import { getThinkingModeFor } from '../../src/providers/ollama/thinking.ts'

interface ShowCall { model: string }

let calls: ShowCall[] = []
let respond: (model: string) => Response | Promise<Response> = () => capabilities(['completion'])
const warnings: string[] = []

function capabilities(list: string[]): Response {
  return new Response(JSON.stringify({ capabilities: list }), { status: 200 })
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const model = JSON.parse(String(init?.body ?? '{}')).model as string
  calls.push({ model })
  check(`asks /api/show for ${model}`, String(input).endsWith('/api/show'), true)
  return await respond(model)
}) as typeof fetch

const realWarn = console.warn
console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')) }

function reset(): void {
  calls = []
  warnings.length = 0
}

// --- a model that reports the capability thinks, whatever its name is
Config.OLLAMA_USE_THINKING = true
respond = () => capabilities(['completion', 'tools', 'thinking', 'vision'])
check('capability -> think:true', await getThinkingModeFor('qwen3.8:27b-q8_0'), true)
check('and no warning', warnings.length, 0)

// --- the probe is cached per model: chat asks on every request
reset()
await getThinkingModeFor('qwen3.8:27b-q8_0')
await getThinkingModeFor('qwen3.8:27b-q8_0')
check('cached after the first probe', calls.length, 0)

// --- gpt-oss keeps its effort level
check('gpt-oss -> max', await getThinkingModeFor('gpt-oss:20b'), 'max')

// --- a model without the capability: off, and said out loud exactly once
reset()
respond = () => capabilities(['completion', 'tools'])
check('no capability -> think:false', await getThinkingModeFor('plain:7b'), false)
await getThinkingModeFor('plain:7b')
check('warned once, not per request', warnings.filter(line => line.includes('plain:7b')).length, 1)

// --- the toggle still wins: off means off, without asking the server
reset()
Config.OLLAMA_USE_THINKING = false
check('toggle off -> think:false', await getThinkingModeFor('fresh:7b'), false)
check('and no probe at all', calls.length, 0)
Config.OLLAMA_USE_THINKING = true

// --- an unreachable server is not a verdict: no thinking now, but nothing cached
reset()
respond = () => { throw new Error('connect ECONNREFUSED') }
check('probe error -> think:false', await getThinkingModeFor('offline:7b'), false)
check('and it says why', warnings.some(line => line.includes('connect ECONNREFUSED')), true)
respond = () => capabilities(['completion', 'thinking'])
check('a failed probe is not cached', await getThinkingModeFor('offline:7b'), true)

// --- an HTTP error is treated the same way
reset()
respond = () => new Response('nope', { status: 404 })
check('HTTP error -> think:false', await getThinkingModeFor('missing:7b'), false)

console.warn = realWarn
done()
