import type { SearchProvider, WebSearchResult } from '../types.ts'
import { Config } from '../../../config.ts'

const SEARCH_TIMEOUT_MS = 15_000
const TRAILING_SLASHES = /\/+$/
const JSON_FORMAT_HINT = 'The instance answers json only when its settings.yml has search: formats: [html, json].'

interface SearxngEntry {
  title?: string
  url?: string
  content?: string
}

interface SearxngResponse {
  results?: SearxngEntry[]
}

function searchEndpoint(): URL {
  const host = Config.WEB_SEARCH_HOST.trim()

  if (host.length === 0) {
    throw new Error('WEB_SEARCH_HOST is empty, and WEB_SEARCH_PROVIDER=searxng needs an instance to query. Set WEB_SEARCH_HOST=http://localhost:8888 (or any SearxNG address).')
  }

  try {
    return new URL(`${host.replace(TRAILING_SLASHES, '')}/search`)
  }
  catch {
    throw new Error(`WEB_SEARCH_HOST is not a valid URL: ${host}. Expected something like http://localhost:8888.`)
  }
}

async function search(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const endpoint = searchEndpoint()
  endpoint.searchParams.set('q', query)
  endpoint.searchParams.set('format', 'json')

  const location = `${endpoint.origin}${endpoint.pathname}`

  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const trimmed = errorText.trim().slice(0, 200)
    const detail = trimmed ? `: ${trimmed}` : ''
    const hint = response.status === 403 || response.status === 400 ? ` ${JSON_FORMAT_HINT}` : ''
    throw new Error(`SearxNG at ${location} returned HTTP ${response.status}${detail}.${hint}`)
  }

  const body = await response.text()
  let payload: SearxngResponse

  try {
    payload = JSON.parse(body) as SearxngResponse
  }
  catch {
    const contentType = response.headers.get('content-type') ?? 'no content type'
    throw new Error(`SearxNG at ${location} answered with ${contentType} instead of json. ${JSON_FORMAT_HINT}`)
  }

  const rawResults = payload.results ?? []

  return rawResults.slice(0, maxResults).map((entry): WebSearchResult => ({
    title: (entry.title ?? '').trim(),
    url: (entry.url ?? '').trim(),
    snippet: (entry.content ?? '').trim(),
  }))
}

function unavailableReason(): string | undefined {
  try {
    searchEndpoint()
    return undefined
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export const searxng: SearchProvider = { search, unavailableReason }
