import { Config } from '../../config.ts'
import { gray } from '../../utils/colors.ts'

const PS_REQUEST_TIMEOUT_MS = 10_000

interface OllamaPsResponse {
  models?: { name?: unknown, context_length?: unknown }[]
}

let loadedTokenLimit: number | null = null

async function fetchLoadedContextLength(): Promise<number | null> {
  try {
    const response = await fetch(`${Config.OLLAMA_HOST}/api/ps`, { signal: AbortSignal.timeout(PS_REQUEST_TIMEOUT_MS) })
    if (!response.ok) {
      return null
    }

    const payload = await response.json() as OllamaPsResponse
    const contextLength = payload.models?.find(model => model.name === Config.MODEL)?.context_length
    return typeof contextLength === 'number' && contextLength > 0 ? contextLength : null
  }
  catch {
    return null
  }
}

function describeContextSource(): string {
  if (Config.CONTEXT_WINDOW_TOKEN_LIMIT !== null) {
    return `${Config.CONTEXT_WINDOW_TOKEN_LIMIT} tokens, CONTEXT_WINDOW_TOKEN_LIMIT`
  }
  if (loadedTokenLimit !== null) {
    return `${loadedTokenLimit} tokens, set in Ollama`
  }
  return 'set in Ollama, known after the first reply'
}

export async function initializeContextWindow(): Promise<void> {
  loadedTokenLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT === null ? await fetchLoadedContextLength() : null
  console.warn(gray(`Model ${Config.MODEL} (context: ${describeContextSource()})`))
}

export async function refreshContextWindow(): Promise<void> {
  loadedTokenLimit = await fetchLoadedContextLength() ?? loadedTokenLimit
}

export function getContextWindowTokenLimit(): number | null {
  return loadedTokenLimit ?? Config.CONTEXT_WINDOW_TOKEN_LIMIT
}
