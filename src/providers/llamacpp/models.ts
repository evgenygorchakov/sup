import type { ModelListResult } from '../types.ts'
import { Config } from '../../config.ts'

const MODELS_REQUEST_TIMEOUT_MS = 10_000

interface OpenAiModelsResponse {
  data?: { id?: unknown }[]
}

export async function listInstalledModels(): Promise<ModelListResult> {
  try {
    const response = await fetch(`${Config.LLAMACPP_HOST}/v1/models`, {
      signal: AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    const payload = await response.json() as OpenAiModelsResponse
    const models = (payload.data ?? [])
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string')
      .sort((first, second) => first.localeCompare(second))

    return { ok: true, models }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** llama-server serves the single model it was started with, so that one is the default. */
export async function resolveDefaultModel(): Promise<string | null> {
  const result = await listInstalledModels()
  return result.ok ? result.models[0] ?? null : null
}
