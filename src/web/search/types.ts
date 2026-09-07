export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchProvider {
  search: (query: string, maxResults: number) => Promise<WebSearchResult[]>
  unavailableReason?: () => string | undefined
}
