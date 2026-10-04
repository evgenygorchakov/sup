import { Config } from '../../config.ts'
import { gray, yellow } from '../../utils/colors.ts'

const PROBE_REQUEST_TIMEOUT_MS = 10_000

interface LlamaCppPropsResponse {
  n_ctx?: unknown
  default_generation_settings?: { n_ctx?: unknown }
  model_alias?: unknown
  model_path?: unknown
}

let resolvedTokenLimit: number | null = null

function readServerContextLength(props: LlamaCppPropsResponse): number | null {
  const candidates = [props.default_generation_settings?.n_ctx, props.n_ctx]
  for (const value of candidates) {
    if (typeof value === 'number' && value > 0) {
      return value
    }
  }
  return null
}

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

async function fetchProps(): Promise<LlamaCppPropsResponse> {
  const response = await fetch(`${Config.LLAMACPP_HOST}/props`, { signal: AbortSignal.timeout(PROBE_REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return await response.json() as LlamaCppPropsResponse
}

function reportUndetected(reason: string): void {
  const fallback = resolvedTokenLimit === null ? '' : ` Using ${resolvedTokenLimit} tokens from CONTEXT_WINDOW_TOKEN_LIMIT.`
  console.warn(yellow(`Could not detect context length from llama.cpp server: ${reason}.${fallback}`))
}

export async function initializeContextWindow(): Promise<void> {
  const requestedLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT
  resolvedTokenLimit = requestedLimit

  let props: LlamaCppPropsResponse
  try {
    props = await fetchProps()
  }
  catch (error) {
    reportUndetected(error instanceof Error ? error.message : String(error))
    return
  }

  const serverMax = readServerContextLength(props)
  if (serverMax === null) {
    reportUndetected('/props did not report n_ctx')
    return
  }

  resolvedTokenLimit = requestedLimit === null ? serverMax : Math.min(requestedLimit, serverMax)
  const detail = resolvedTokenLimit === serverMax ? `${serverMax} tokens` : `${resolvedTokenLimit} of ${serverMax} tokens`
  console.warn(gray(`Connected to llama.cpp (model ${readServerModelName(props)}, context: ${detail})`))
}

export function getContextWindowTokenLimit(): number | null {
  return resolvedTokenLimit
}
