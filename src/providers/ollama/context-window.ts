import type { ContextWindowProbeResult } from '../context-window.ts'
import { Config } from '../../config.ts'
import { createContextWindow } from '../context-window.ts'

interface OllamaShowResponse {
  model_info?: Record<string, unknown>
}

function readModelContextLength(modelInfo: Record<string, unknown>): number | null {
  const contextLengthKey = Object.keys(modelInfo).find(key => key.endsWith('.context_length'))
  if (!contextLengthKey) {
    return null
  }

  const rawValue = modelInfo[contextLengthKey]
  return typeof rawValue === 'number' && rawValue > 0 ? rawValue : null
}

async function probeModel(signal: AbortSignal): Promise<ContextWindowProbeResult> {
  const response = await fetch(`${Config.OLLAMA_HOST}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: Config.MODEL }),
    signal,
  })

  if (!response.ok) {
    return { detected: false, reason: `HTTP ${response.status}` }
  }

  const payload = await response.json() as OllamaShowResponse
  const modelMax = readModelContextLength(payload.model_info ?? {})

  if (modelMax === null) {
    return { detected: false, reason: 'model_info did not report context_length' }
  }

  return {
    detected: true,
    serverMax: modelMax,
    banner: detail => `Loaded model ${Config.MODEL} (context: ${detail})`,
  }
}

export const { initializeContextWindow, getContextWindowTokenLimit } = createContextWindow(
  probeModel,
  (reason, tokenLimit) => `Could not detect context length for model ${Config.MODEL}: ${reason}. Using ${tokenLimit} tokens.`,
)
