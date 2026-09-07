import type { SearchProvider } from './types.ts'
import { Config } from '../../config.ts'
import { ollama } from './providers/ollama.ts'
import { searxng } from './providers/searxng.ts'

const providersByName: Record<string, SearchProvider> = { ollama, searxng }

export const searchProviderNames = Object.keys(providersByName)

export function getSearchProvider(name?: string): SearchProvider {
  const providerName = name ?? Config.WEB_SEARCH_PROVIDER
  const provider = providersByName[providerName]

  if (!provider) {
    throw new Error(`Unknown web search provider: ${providerName}. Available: ${searchProviderNames.join(', ')}`)
  }

  return provider
}
