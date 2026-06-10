import { Config } from '../../config.ts'
import { gray, yellow } from '../../utils/colors.ts'

const SHOW_REQUEST_TIMEOUT_MS = 10_000

interface OllamaShowResponse {
  model_info?: Record<string, unknown>
}

let resolvedContextWindowTokenLimit: number = Config.CONTEXT_WINDOW_TOKEN_LIMIT

export function getContextWindowTokenLimit(): number {
  return resolvedContextWindowTokenLimit
}

interface ContextUsage {
  prompt: number
  completion: number
}

let lastContextUsage: ContextUsage | null = null

export function recordContextUsage(prompt: number, completion: number): void {
  lastContextUsage = { prompt, completion }
}

export function getLastContextUsage(): ContextUsage | null {
  return lastContextUsage
}

export function resetContextUsage(): void {
  lastContextUsage = null
}

function readModelContextLength(modelInfo: Record<string, unknown>): number | null {
  const contextLengthKey = Object.keys(modelInfo).find(key => key.endsWith('.context_length'))
  if (!contextLengthKey) {
    return null
  }

  const rawValue = modelInfo[contextLengthKey]
  return typeof rawValue === 'number' && rawValue > 0 ? rawValue : null
}

function reportFallback(reason: string): void {
  console.warn(yellow(`Could not detect context length for model ${Config.MODEL}: ${reason}. Using configured limit ${Config.CONTEXT_WINDOW_TOKEN_LIMIT}.`))
}

export async function initializeContextWindow(): Promise<void> {
  const userRequestedLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT

  // Start from the configured limit so a failed detection below never leaves
  // a limit inherited from a previously selected model.
  resolvedContextWindowTokenLimit = userRequestedLimit

  let response: Response
  try {
    response = await fetch(`${Config.HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: Config.MODEL }),
      signal: AbortSignal.timeout(SHOW_REQUEST_TIMEOUT_MS),
    })
  }
  catch (error) {
    reportFallback(error instanceof Error ? error.message : String(error))
    return
  }

  if (!response.ok) {
    reportFallback(`HTTP ${response.status}`)
    return
  }

  const payload = await response.json() as OllamaShowResponse
  const modelMax = readModelContextLength(payload.model_info ?? {})

  if (modelMax === null) {
    reportFallback('model_info did not report context_length')
    return
  }

  const effectiveLimit = Math.min(userRequestedLimit, modelMax)
  resolvedContextWindowTokenLimit = effectiveLimit

  const detail = effectiveLimit === modelMax
    ? `${effectiveLimit} tokens`
    : `${effectiveLimit} of ${modelMax} tokens`
  console.warn(gray(`Loaded model ${Config.MODEL} (context: ${detail})`))
}
