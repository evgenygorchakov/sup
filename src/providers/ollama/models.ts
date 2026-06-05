import { Config } from '../../config.ts'

const TAGS_REQUEST_TIMEOUT_MS = 10_000

interface OllamaTagsResponse {
  models?: { name?: unknown }[]
}

export type ModelListResult
  = | { ok: true, models: string[] }
    | { ok: false, error: string }

export async function listInstalledModels(): Promise<ModelListResult> {
  try {
    const response = await fetch(`${Config.HOST}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }

    const payload = await response.json() as OllamaTagsResponse
    const models = (payload.models ?? [])
      .map(entry => entry.name)
      .filter((name): name is string => typeof name === 'string')
      .sort((first, second) => first.localeCompare(second))

    return { ok: true, models }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
