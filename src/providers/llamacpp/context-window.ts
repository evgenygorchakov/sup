import { Config } from '../../config.ts'
import { gray, yellow } from '../../utils/colors.ts'

const PROPS_REQUEST_TIMEOUT_MS = 10_000

interface LlamaCppPropsResponse {
  n_ctx?: unknown
  default_generation_settings?: { n_ctx?: unknown }
}

let resolvedContextWindowTokenLimit: number = Config.CONTEXT_WINDOW_TOKEN_LIMIT

export function getContextWindowTokenLimit(): number {
  return resolvedContextWindowTokenLimit
}

function readServerContextLength(props: LlamaCppPropsResponse): number | null {
  // Prefer the per-slot context the server actually serves; fall back to the
  // top-level n_ctx some builds expose.
  const candidates = [props.default_generation_settings?.n_ctx, props.n_ctx]
  for (const value of candidates) {
    if (typeof value === 'number' && value > 0) {
      return value
    }
  }
  return null
}

function reportFallback(reason: string): void {
  console.warn(yellow(`Could not detect context length from llama.cpp server: ${reason}. Using configured limit ${Config.CONTEXT_WINDOW_TOKEN_LIMIT}.`))
}

export async function initializeContextWindow(): Promise<void> {
  const userRequestedLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT

  // Start from the configured limit so a failed detection never leaves a limit
  // inherited from a previous state.
  resolvedContextWindowTokenLimit = userRequestedLimit

  let response: Response
  try {
    response = await fetch(`${Config.HOST}/props`, {
      signal: AbortSignal.timeout(PROPS_REQUEST_TIMEOUT_MS),
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

  const payload = await response.json() as LlamaCppPropsResponse
  const serverMax = readServerContextLength(payload)

  if (serverMax === null) {
    reportFallback('/props did not report n_ctx')
    return
  }

  const effectiveLimit = Math.min(userRequestedLimit, serverMax)
  resolvedContextWindowTokenLimit = effectiveLimit

  const detail = effectiveLimit === serverMax
    ? `${effectiveLimit} tokens`
    : `${effectiveLimit} of ${serverMax} tokens`
  console.warn(gray(`Connected to llama.cpp (model ${Config.MODEL}, context: ${detail})`))
}
