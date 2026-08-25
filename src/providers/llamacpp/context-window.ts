import type { ContextWindowProbeResult } from '../context-window.ts'
import { Config } from '../../config.ts'
import { createContextWindow } from '../context-window.ts'

interface LlamaCppPropsResponse {
  n_ctx?: unknown
  default_generation_settings?: { n_ctx?: unknown }
  model_alias?: unknown
  model_path?: unknown
}

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

async function probeServer(signal: AbortSignal): Promise<ContextWindowProbeResult> {
  const response = await fetch(`${Config.LLAMACPP_HOST}/props`, { signal })

  if (!response.ok) {
    return { detected: false, reason: `HTTP ${response.status}` }
  }

  const props = await response.json() as LlamaCppPropsResponse
  const serverMax = readServerContextLength(props)

  if (serverMax === null) {
    return { detected: false, reason: '/props did not report n_ctx' }
  }

  return {
    detected: true,
    serverMax,
    banner: detail => `Connected to llama.cpp (model ${readServerModelName(props)}, context: ${detail})`,
  }
}

export const { initializeContextWindow, getContextWindowTokenLimit } = createContextWindow(
  probeServer,
  (reason, tokenLimit) => `Could not detect context length from llama.cpp server: ${reason}. Using ${tokenLimit} tokens.`,
)
