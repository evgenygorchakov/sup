import type { ModelListResult } from '../types.ts'
import { Config } from '../../config.ts'

const TAGS_REQUEST_TIMEOUT_MS = 10_000
const SHOW_REQUEST_TIMEOUT_MS = 10_000

interface OllamaModelEntry {
  name?: unknown
  modified_at?: unknown
}

interface OllamaTagsResponse {
  models?: OllamaModelEntry[]
}

function readModelName(entry: OllamaModelEntry): string | null {
  return typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : null
}

async function fetchTags(): Promise<OllamaModelEntry[]> {
  const response = await fetch(`${Config.OLLAMA_HOST}/api/tags`, {
    signal: AbortSignal.timeout(TAGS_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const payload = await response.json() as OllamaTagsResponse
  return payload.models ?? []
}

export async function listInstalledModels(): Promise<ModelListResult> {
  try {
    const models = (await fetchTags())
      .map(readModelName)
      .filter((name): name is string => name !== null)
      .sort((first, second) => first.localeCompare(second))

    return { ok: true, models }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Ollama has no notion of a "default" model, so pick the most recently pulled one. */
export async function resolveDefaultModel(): Promise<string | null> {
  let entries: OllamaModelEntry[]
  try {
    entries = await fetchTags()
  }
  catch {
    return null
  }

  const dated = entries
    .map(entry => ({ name: readModelName(entry), at: Date.parse(String(entry.modified_at)) }))
    .filter((entry): entry is { name: string, at: number } => entry.name !== null)
    .map(entry => ({ name: entry.name, at: Number.isNaN(entry.at) ? -1 : entry.at }))

  if (dated.length === 0) {
    return null
  }

  return dated.reduce((best, entry) => (entry.at > best.at ? entry : best)).name
}

/** `/api/show` resolves tags server-side, so its 404 is the authoritative "no such model". */
export async function checkConfiguredModel(): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(`${Config.OLLAMA_HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: Config.MODEL }),
      signal: AbortSignal.timeout(SHOW_REQUEST_TIMEOUT_MS),
    })
    await response.text()
  }
  catch {
    // Unreachable server is not a missing model: let the first request report it.
    return null
  }

  if (response.status !== 404) {
    return null
  }

  const installed = await listInstalledModels()
  const available = installed.ok && installed.models.length > 0
    ? `\nInstalled models: ${installed.models.join(', ')}`
    : ''

  return `Model ${Config.MODEL} is not installed on ollama at ${Config.OLLAMA_HOST}.${available}\nPull it with "ollama pull ${Config.MODEL}", set another MODEL in your .env, or leave MODEL empty to pick the most recent one.`
}
