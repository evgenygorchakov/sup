/** Sampling knobs: a value set in Config reaches the request body, an unset one is not sent at all.
 *  No server — fetch is stubbed and the body is read back. Run with: node test/run.ts sampling. */
import type { Message } from '../../src/types.ts'
import { check, done } from '../lib/check.ts'
import { Config } from '../../src/config.ts'
import { chat as llamacppChat } from '../../src/providers/llamacpp/chat.ts'
import { chat as ollamaChat } from '../../src/providers/ollama/chat.ts'
import { getOptionalEnvNumberInRange } from '../../src/utils/env.ts'

const messages: Message[] = [{ role: 'user', content: 'hi' }]

let lastBody: Record<string, unknown> = {}

globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  lastBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  return new Response(JSON.stringify({
    message: { role: 'assistant', content: 'ok' },
    choices: [{ message: { content: 'ok' } }],
  }), { status: 200 })
}) as typeof fetch

function ollamaOptions(): Record<string, unknown> {
  return lastBody.options as Record<string, unknown>
}

Config.OLLAMA_USE_THINKING = false

// --- a value that is set reaches the body: Ollama nests it in options
Config.TEMPERATURE = 0.2
Config.REPEAT_PENALTY = 1.1
await ollamaChat(messages)
check('ollama sends temperature', ollamaOptions().temperature, 0.2)
check('ollama sends repeat_penalty', ollamaOptions().repeat_penalty, 1.1)

// --- llama.cpp puts both at the top level of the body
await llamacppChat(messages)
check('llama.cpp sends temperature', lastBody.temperature, 0.2)
check('llama.cpp sends repeat_penalty', lastBody.repeat_penalty, 1.1)

// --- null means the field is absent, not zero: the model's own value wins
Config.TEMPERATURE = null
Config.REPEAT_PENALTY = null
await ollamaChat(messages)
check('ollama omits temperature entirely', Object.hasOwn(ollamaOptions(), 'temperature'), false)
check('ollama omits repeat_penalty entirely', Object.hasOwn(ollamaOptions(), 'repeat_penalty'), false)
check('and still sends num_ctx', typeof ollamaOptions().num_ctx, 'number')

await llamacppChat(messages)
check('llama.cpp omits temperature entirely', Object.hasOwn(lastBody, 'temperature'), false)
check('llama.cpp omits repeat_penalty entirely', Object.hasOwn(lastBody, 'repeat_penalty'), false)
check('and still sends max_tokens', typeof lastBody.max_tokens, 'number')

// --- zero is a real value, told apart from unset
Config.TEMPERATURE = 0
await ollamaChat(messages)
check('temperature 0 is sent, not skipped', ollamaOptions().temperature, 0)

function read(value: string | undefined, min: number, max: number): unknown {
  if (value === undefined) {
    delete process.env.SAMPLING_PROBE
  }
  else {
    process.env.SAMPLING_PROBE = value
  }

  try {
    return getOptionalEnvNumberInRange('SAMPLING_PROBE', min, max)
  }
  catch (error) {
    return error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
  }
}

// --- an absent or empty variable hands the parameter to the model
check('absent -> null', read(undefined, 0, 2), null)
check('empty -> null', read('', 0, 2), null)
check('in range -> the number', read('0.6', 0, 2), 0.6)
check('the bounds themselves are allowed', read('2', 0, 2), 2)

// --- out of range fails at startup instead of travelling to the server
check('5 is out of [0, 2]', read('5', 0, 2), 'RangeError: Env variable SAMPLING_PROBE must be between 0 and 2, got 5. Leave it empty to let the model decide.')
check('-1 is out of [0, 2]', String(read('-1', 0, 2)).startsWith('RangeError'), true)
check('a penalty of 0.3 is out of [1, 2]', String(read('0.3', 1, 2)).startsWith('RangeError'), true)
check('not a number is still a TypeError', String(read('warm', 0, 2)).startsWith('TypeError'), true)

// --- REPEAT_PENALTY=0 used to mean "do not send": now it is a loud error naming the replacement
check('penalty 0 is refused', String(read('0', 1, 2)).startsWith('RangeError'), true)
check('and says how to switch the penalty off', String(read('0', 1, 2)).includes('Leave it empty'), true)

done()
