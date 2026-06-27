import { Config } from '../../config.ts'
import { gray, yellow } from '../../utils/colors.ts'

const PROPS_REQUEST_TIMEOUT_MS = 10_000

interface LlamaCppPropsResponse {
  n_ctx?: unknown
  default_generation_settings?: { n_ctx?: unknown }
  model_alias?: unknown
  model_path?: unknown
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

// llama.cpp ignores Config.MODEL and serves the model loaded at startup, so the
// real name lives in /props: prefer model_alias, then the gguf filename from
// model_path (a Windows path may use backslashes), and only then fall back to
// the configured MODEL.
function readServerModelName(props: LlamaCppPropsResponse): string {
  if (typeof props.model_alias === 'string' && props.model_alias.length > 0) {
    return props.model_alias
  }
  if (typeof props.model_path === 'string' && props.model_path.length > 0) {
    const basename = props.model_path.split(/[/\\]/).pop()
    if (basename) {
      return basename
    }
  }
  return Config.MODEL
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
    response = await fetch(`${Config.LLAMACPP_HOST}/props`, {
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
  console.warn(gray(`Connected to llama.cpp (model ${readServerModelName(payload)}, context: ${detail})`))
}
