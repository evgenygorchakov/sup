import type { WebSearchResult } from './types.ts'
import process from 'node:process'

const OLLAMA_WEB_SEARCH_ENDPOINT = 'https://ollama.com/api/web_search'
const SEARCH_TIMEOUT_MS = 15_000

interface OllamaWebSearchEntry {
  title?: string
  url?: string
  content?: string
}

interface OllamaWebSearchResponse {
  results?: OllamaWebSearchEntry[]
}

export async function searchOllama(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.OLLAMA_API_KEY

  if (!apiKey) {
    throw new Error('OLLAMA_API_KEY is not set. Get a key at https://ollama.com/settings/keys and export OLLAMA_API_KEY=<key>.')
  }

  const response = await fetch(OLLAMA_WEB_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, max_results: maxResults }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    const trimmed = errorText.trim().slice(0, 200)
    const detail = trimmed ? `: ${trimmed}` : ''
    throw new Error(`Ollama web search returned HTTP ${response.status}${detail}`)
  }

  const payload = await response.json() as OllamaWebSearchResponse
  const rawResults = payload.results ?? []

  return rawResults.slice(0, maxResults).map((entry): WebSearchResult => ({
    title: (entry.title ?? '').trim(),
    url: (entry.url ?? '').trim(),
    snippet: (entry.content ?? '').trim(),
  }))
}
