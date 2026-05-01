import type { Tool } from '../../types.ts'
import { Config } from '../../config.ts'
import { cyan } from '../../utils/colors.ts'
import { truncateText } from './shared.ts'
import { searchOllama } from './web-search/ollama.ts'

const PREVIEW_RESULT_COUNT = 5

export const webSearch: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Searches the web and returns a list of results with title, URL and snippet. USE WHEN: you need a fresh fact from the internet and the exact URL is unknown (e.g. latest library versions, recent events, current docs). Pair with fetch_url to read a specific page from the results. DO NOT USE FOR: questions you can already answer from the conversation, or when a URL is already known (use fetch_url directly). EXAMPLE: {"query": "ollama tool calling format 2025"}.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query in plain text.',
          },
          maxResults: {
            type: 'number',
            description: `Maximum number of results to return. Capped at ${Config.WEB_SEARCH_MAX_RESULTS}.`,
          },
        },
        required: ['query'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { query?: unknown, maxResults?: unknown }
    const query = args.query

    if (typeof query !== 'string' || query.trim().length === 0) {
      return 'ERROR: web_search expects { query: string, maxResults?: number }'
    }

    const requestedCount = typeof args.maxResults === 'number' ? args.maxResults : Config.WEB_SEARCH_MAX_RESULTS
    const resultsLimit = Math.max(1, Math.min(Config.WEB_SEARCH_MAX_RESULTS, requestedCount))

    const results = await searchOllama(query.trim(), resultsLimit)

    if (results.length === 0) {
      return `No results for "${query.trim()}"`
    }

    const formatted = results
      .map((entry, index) => `${index + 1}. ${entry.title}\n   ${entry.url}\n   ${entry.snippet}`)
      .join('\n\n')

    return truncateText(formatted)
  },
  primaryArgs: ['query', 'maxResults'],
  accentColor: cyan,
  renderResult: (args, result) => {
    if (result.startsWith('No results')) {
      return result
    }

    const entries = result.split('\n\n').filter(entry => entry.length > 0 && !entry.startsWith('...['))
    const query = typeof args.query === 'string' ? args.query : ''
    const header = `Found ${entries.length} results for "${query}"`

    const preview = entries
      .slice(0, PREVIEW_RESULT_COUNT)
      .map((entry) => {
        const [titleLine, urlLine] = entry.split('\n')
        return `${titleLine}\n${urlLine ?? ''}`
      })
      .join('\n')

    const remainder = entries.length > PREVIEW_RESULT_COUNT
      ? `\n… +${entries.length - PREVIEW_RESULT_COUNT} more results`
      : ''

    return `${header}\n${preview}${remainder}`
  },
  autoApprove: false,
}
