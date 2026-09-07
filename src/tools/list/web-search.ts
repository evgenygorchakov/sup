import type { Tool } from '../../types.ts'
import { Config } from '../../config.ts'
import { cyan } from '../../utils/colors.ts'
import { describeDomainFilter, filterByDomain, normalizeDomainList } from '../../web/search/domains.ts'
import { getSearchProvider } from '../../web/search/registry.ts'
import { searchExcerpt } from '../../web/search/snippet.ts'
import { truncateText } from './shared.ts'

const PREVIEW_RESULT_COUNT = 5
const TITLES_ONLY_NEXT_STEP = 'Titles and URLs only, no page text: fetch_url the most promising one before answering.'
const EXCERPT_NEXT_STEP = 'The excerpts are too short to answer from: fetch_url the most promising result before answering.'
const ENTRY_HEADING_PATTERN = /^(\d+)\. (.*)\n {3}(https?:\/\/\S+)$/gm

export const webSearch: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Searches the web and returns a numbered list of titles and URLs — no page text at all, so the answer is never in this reply itself. USE WHEN: you need a fresh fact from the internet and the exact URL is unknown (e.g. latest library versions, recent events, current docs). Pick the results that look right and read them with fetch_url. Narrow the search to official docs with allowedDomains, or drop known-noisy sites with blockedDomains. DO NOT USE FOR: questions you can already answer from the conversation, or when a URL is already known (use fetch_url directly). EXAMPLE: {"query": "ollama tool calling format 2026"} or {"query": "asyncio task groups", "allowedDomains": ["docs.python.org"]}.',
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
          allowedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keep only results from these domains, subdomains included. Example: ["docs.python.org", "nodejs.org"].',
          },
          blockedDomains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Drop results from these domains, subdomains included.',
          },
        },
        required: ['query'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { query?: unknown, maxResults?: unknown, allowedDomains?: unknown, blockedDomains?: unknown }
    const query = args.query

    if (typeof query !== 'string' || query.trim().length === 0) {
      return 'ERROR: web_search expects { query: string, maxResults?: number, allowedDomains?: string[], blockedDomains?: string[] }'
    }

    const trimmedQuery = query.trim()
    const requestedCount = typeof args.maxResults === 'number' ? args.maxResults : Config.WEB_SEARCH_MAX_RESULTS
    const resultsLimit = Math.max(1, Math.min(Config.WEB_SEARCH_MAX_RESULTS, requestedCount))

    const allowedDomains = normalizeDomainList(args.allowedDomains)
    const blockedDomains = normalizeDomainList(args.blockedDomains)
    const filtered = allowedDomains.length > 0 || blockedDomains.length > 0

    const provider = getSearchProvider()
    const found = await provider.search(trimmedQuery, filtered ? Config.WEB_SEARCH_MAX_RESULTS : resultsLimit)

    if (found.length === 0) {
      return `No results for "${trimmedQuery}"`
    }

    const kept = filtered ? filterByDomain(found, allowedDomains, blockedDomains) : found

    if (kept.length === 0) {
      return `No results for "${trimmedQuery}" within ${describeDomainFilter(allowedDomains, blockedDomains)}: all ${found.length} results came from other domains. Widen or drop the domain filter.`
    }

    const results = kept.slice(0, resultsLimit)
    const dropped = found.length > kept.length ? `, ${found.length - kept.length} dropped by the domain filter` : ''

    const excerptChars = Config.WEB_SEARCH_RESULT_CHARS
    const entries = results
      .map((entry, index) => {
        const heading = `${index + 1}. ${entry.title || '(untitled)'}\n   ${entry.url}`
        const excerpt = excerptChars > 0 ? searchExcerpt(entry.snippet, trimmedQuery, excerptChars) : ''

        return excerpt ? `${heading}\n   ${excerpt}` : heading
      })
      .join(excerptChars > 0 ? '\n\n' : '\n')

    const headline = results.length === 1 ? '1 result' : `${results.length} results`
    const nextStep = excerptChars > 0 ? EXCERPT_NEXT_STEP : TITLES_ONLY_NEXT_STEP

    return truncateText(`Found ${headline} for "${trimmedQuery}"${dropped}\n\n${entries}\n\n${nextStep}`)
  },
  primaryArgs: ['query', 'maxResults', 'allowedDomains', 'blockedDomains'],
  accentColor: cyan,
  renderResult: (_args, result) => {
    if (result.startsWith('No results')) {
      return result
    }

    const headline = result.split('\n')[0] ?? ''
    const headings = [...result.matchAll(ENTRY_HEADING_PATTERN)]

    const preview = headings
      .slice(0, PREVIEW_RESULT_COUNT)
      .map(([, position, title, url]) => `${position}. ${title}\n   ${url}`)
      .join('\n')

    const remainder = headings.length > PREVIEW_RESULT_COUNT
      ? `\n… +${headings.length - PREVIEW_RESULT_COUNT} more results`
      : ''

    return `${headline}\n${preview}${remainder}`
  },
  autoApprove: false,
}
