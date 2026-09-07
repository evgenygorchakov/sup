/** web_search: how it filters results by domain, cuts an excerpt around the query, renders
 *  titles and URLs, and talks to both search providers. No network — the providers answer
 *  through a stubbed fetch. Run with: node test/run.ts (or node test/unit/web-search.ts). */
import process from 'node:process'
import { check, done } from '../lib/check.ts'
import { Config } from '../../src/config.ts'
import { webSearch } from '../../src/tools/list/web-search.ts'
import { describeDomainFilter, filterByDomain, normalizeDomainList } from '../../src/web/search/domains.ts'
import { getSearchProvider, searchProviderNames } from '../../src/web/search/registry.ts'
import { searchExcerpt } from '../../src/web/search/snippet.ts'

// --- domain lists come from a model, so they arrive in every shape
check('domains: plain host', normalizeDomainList(['docs.python.org']), ['docs.python.org'])
check('domains: url shaped', normalizeDomainList(['https://www.Nodejs.org/api/fs.html']), ['nodejs.org'])
check('domains: port and trailing dot', normalizeDomainList(['example.com:8443', 'example.org.']), ['example.com', 'example.org'])
check('domains: junk is dropped', normalizeDomainList(['', '   ', 42, null]), [])
check('domains: a non-array is no filter', normalizeDomainList('docs.python.org'), [])

const results = [
  { title: 'a', url: 'https://docs.python.org/3/library/asyncio.html', snippet: '' },
  { title: 'b', url: 'https://www.docs.python.org/3/whatsnew.html', snippet: '' },
  { title: 'c', url: 'https://medium.com/@someone/python-asyncio', snippet: '' },
  { title: 'd', url: 'https://python.org.evil.example/asyncio', snippet: '' },
  { title: 'e', url: 'not a url', snippet: '' },
]

const titlesOf = (kept: typeof results): string[] => kept.map(entry => entry.title)

check('filter: allowed keeps the domain and its subdomains', titlesOf(filterByDomain(results, ['python.org'], [])), ['a', 'b'])
check('filter: a lookalike domain does not pass', titlesOf(filterByDomain(results, ['python.org'], [])).includes('d'), false)
check('filter: blocked drops one host', titlesOf(filterByDomain(results, [], ['medium.com'])), ['a', 'b', 'd', 'e'])
check('filter: both lists apply', titlesOf(filterByDomain(results, ['python.org'], ['docs.python.org'])), [])
check('filter: no filter keeps everything', titlesOf(filterByDomain(results, [], [])), ['a', 'b', 'c', 'd', 'e'])
check('filter: describes itself', describeDomainFilter(['python.org'], ['medium.com']), 'only python.org, without medium.com')

// --- the excerpt is a window around the query, not the head of the page
const page = `Install it first. ${'filler '.repeat(60)}the timeout is closed by the server after 30 seconds${' tail'.repeat(60)}`

check('excerpt: a short text comes back whole', searchExcerpt('  two   lines\nhere ', 'lines', 80), 'two lines here')
check('excerpt: 0 chars means no excerpt at all', searchExcerpt(page, 'timeout', 0), '')
check('excerpt: the window holds the match', searchExcerpt(page, 'timeout', 120).includes('timeout is closed'), true)
check('excerpt: a shifted window is marked at both ends', /^….*…$/.test(searchExcerpt(page, 'timeout', 120)), true)
check('excerpt: the head of the page is left behind', searchExcerpt(page, 'timeout', 120).includes('Install it first'), false)
check('excerpt: no match falls back to the head', searchExcerpt(page, 'websocket', 60).startsWith('Install it first'), true)
check('excerpt: the window keeps to the limit', searchExcerpt(page, 'timeout', 120).length <= 122, true)
check('excerpt: whitespace is collapsed to one line', searchExcerpt('a\n\n  b\tc', 'b', 40).includes('\n'), false)

const noisyPage = `Server home page. ${'filler '.repeat(60)}the server timeout is 30 seconds${' tail'.repeat(60)}`

check('excerpt: the window holding most of the query beats the first hit', searchExcerpt(noisyPage, 'server timeout seconds', 120).includes('server timeout is 30 seconds'), true)
check('excerpt: a match at the very end still fits in the window', searchExcerpt(`${'filler '.repeat(60)}the closing note mentions webhooks`, 'webhooks', 80).endsWith('webhooks'), true)

// --- the whole search tool over a stubbed Ollama: what the model reads in the first line
Config.WEB_SEARCH_PROVIDER = 'ollama'
Config.WEB_SEARCH_MAX_RESULTS = 10
Config.WEB_SEARCH_RESULT_CHARS = 0
process.env.OLLAMA_API_KEY = 'test-key'

const hosts = ['docs.python.org', 'docs.python.org', 'medium.com', 'medium.com', 'nodejs.org', 'medium.com', 'nodejs.org', 'medium.com', 'medium.com', 'medium.com']
globalThis.fetch = (async () => new Response(JSON.stringify({
  results: hosts.map((host, index) => ({ title: index === 0 ? '' : `page ${index}`, url: `https://${host}/page-${index}`, content: `Install it first. ${'body '.repeat(40)}asyncio task groups run in parallel${' more'.repeat(40)}` })),
}), { status: 200 })) as typeof fetch

const headlineOf = async (args: Record<string, unknown>): Promise<string> => (await webSearch.handler(args)).split('\n')[0] ?? ''

check('search: unfiltered headline counts what is shown', await headlineOf({ query: 'python asyncio', maxResults: 5 }), 'Found 5 results for "python asyncio"')
check('search: the maxResults cut is not called a filter drop', (await headlineOf({ query: 'python asyncio', maxResults: 5 })).includes('dropped'), false)
check('search: the filter drop count is the filter alone', await headlineOf({ query: 'python asyncio', maxResults: 2, allowedDomains: ['python.org'] }), 'Found 2 results for "python asyncio", 8 dropped by the domain filter')
check('search: one result reads as one', await headlineOf({ query: 'python asyncio', maxResults: 1 }), 'Found 1 result for "python asyncio"')
check('search: an empty title still gets a line', (await webSearch.handler({ query: 'python asyncio', maxResults: 1 })).includes('1. (untitled)'), true)
check('search: everything filtered out says so', await webSearch.handler({ query: 'python asyncio', allowedDomains: ['example.invalid'] }), 'No results for "python asyncio" within only example.invalid: all 10 results came from other domains. Widen or drop the domain filter.')

const titlesOnly = await webSearch.handler({ query: 'python asyncio', maxResults: 3 })

check('search: an entry is a title and a url, nothing else', titlesOnly.split('\n\n')[1], '1. (untitled)\n   https://docs.python.org/page-0\n2. page 1\n   https://docs.python.org/page-1\n3. page 2\n   https://medium.com/page-2')
check('search: no page text reaches the context', titlesOnly.includes('body'), false)
check('search: the reply says where to read the page', titlesOnly.endsWith('Titles and URLs only, no page text: fetch_url the most promising one before answering.'), true)
check('search: the UI preview keeps the titles', webSearch.renderResult?.({ query: 'python asyncio' }, titlesOnly), 'Found 3 results for "python asyncio"\n1. (untitled)\n   https://docs.python.org/page-0\n2. page 1\n   https://docs.python.org/page-1\n3. page 2\n   https://medium.com/page-2')

Config.WEB_SEARCH_RESULT_CHARS = 60
const withExcerpts = await webSearch.handler({ query: 'asyncio task groups', maxResults: 2 })

check('search: an excerpt is added under the url when asked for', withExcerpts.split('\n\n')[1]?.split('\n')[2]?.startsWith('   …'), true)
check('search: the excerpt is the part about the query', withExcerpts.includes('asyncio task groups run in parallel'), true)
check('search: the head of the page is not what is shown', withExcerpts.includes('Install it first'), false)
check('search: excerpts do not make the answer', withExcerpts.endsWith('The excerpts are too short to answer from: fetch_url the most promising result before answering.'), true)

// --- searxng: the second provider, on a stubbed instance
const failureOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
    return 'no error'
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

check('registry: both providers are registered', searchProviderNames, ['ollama', 'searxng'])
check('registry: the default follows the config', getSearchProvider() === getSearchProvider('ollama'), true)
check('registry: an unknown name lists what there is', await failureOf(async () => getSearchProvider('duckduckgo')), 'Unknown web search provider: duckduckgo. Available: ollama, searxng')

Config.WEB_SEARCH_PROVIDER = 'searxng'
Config.WEB_SEARCH_HOST = ''
check('searxng: an empty host names the setting', (await failureOf(() => getSearchProvider().search('python asyncio', 3))).startsWith('WEB_SEARCH_HOST is empty'), true)

Config.WEB_SEARCH_HOST = 'localhost 8888'
check('searxng: a host that is not a url says so', (await failureOf(() => getSearchProvider().search('python asyncio', 3))).startsWith('WEB_SEARCH_HOST is not a valid URL'), true)

Config.WEB_SEARCH_HOST = 'http://localhost:8888/'
let requestedUrl = ''
globalThis.fetch = (async (input: unknown) => {
  requestedUrl = String(input)
  return new Response(JSON.stringify({
    results: [
      { title: ' Task Groups ', url: ' https://docs.python.org/3/library/asyncio-task.html ', content: ' Running tasks concurrently ' },
      { title: 'Second', url: 'https://nodejs.org/api/fs.html' },
      { title: 'Third', url: 'https://example.com/three', content: 'three' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const searxngResults = await getSearchProvider().search('python asyncio', 2)

check('searxng: it asks the instance for json', requestedUrl, 'http://localhost:8888/search?q=python+asyncio&format=json')
check('searxng: results are trimmed and mapped', searxngResults[0], { title: 'Task Groups', url: 'https://docs.python.org/3/library/asyncio-task.html', snippet: 'Running tasks concurrently' })
check('searxng: a result without content still counts', searxngResults[1], { title: 'Second', url: 'https://nodejs.org/api/fs.html', snippet: '' })
check('searxng: maxResults cuts the list', searxngResults.length, 2)

globalThis.fetch = (async () => new Response('<!DOCTYPE html><html><body>results</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch
const htmlAnswer = await failureOf(() => getSearchProvider().search('python asyncio', 3))

check('searxng: html instead of json names the content type', htmlAnswer.includes('answered with text/html instead of json'), true)
check('searxng: and says what to change in settings.yml', htmlAnswer.includes('search: formats: [html, json]'), true)

globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch
const forbidden = await failureOf(() => getSearchProvider().search('python asyncio', 3))

check('searxng: an http error keeps the status and the body', forbidden.startsWith('SearxNG at http://localhost:8888/search returned HTTP 403: forbidden.'), true)
check('searxng: 403 is where the json format is explained', forbidden.includes('search: formats: [html, json]'), true)

globalThis.fetch = (async () => new Response('boom', { status: 502 })) as typeof fetch
check('searxng: an unrelated status is not blamed on the format', (await failureOf(() => getSearchProvider().search('python asyncio', 3))).includes('formats'), false)

done()
