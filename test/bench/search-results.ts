#!/usr/bin/env node
/** Measure how much of a web_search result actually survives into the model's context.
 *
 *     node test/bench/search-results.ts
 *
 * The search API returns whole pages in `content`, so the interesting number is how much of
 * that is dropped: with WEB_SEARCH_RESULT_CHARS=0 the reply is titles and URLs, above 0 every
 * result also carries an excerpt around the query, and the 20k output cap applies to both.
 */
import { Config } from '../../src/config.ts'
import { webSearch } from '../../src/tools/list/web-search.ts'
import { getSearchProvider } from '../../src/web/search/registry.ts'

const ENTRY_HEADING_PATTERN = /^(\d+)\. (.*)\n {3}(https?:\/\/\S+)$/gm

const queries = [
  'ollama tool calling format 2026',
  'node.js 26 fetch api changes',
  'как работает KV cache в трансформерах',
  'qwen3 quantization q8_0 vs q4_k_m quality',
]

console.log(`WEB_SEARCH_MAX_RESULTS=${Config.WEB_SEARCH_MAX_RESULTS} WEB_SEARCH_RESULT_CHARS=${Config.WEB_SEARCH_RESULT_CHARS}\n`)

for (const query of queries) {
  const startedAt = Date.now()
  const rendered = await webSearch.handler({ query })
  const elapsedMs = Date.now() - startedAt

  const raw = await getSearchProvider().search(query, Config.WEB_SEARCH_MAX_RESULTS)
  const rawChars = raw.reduce((total, entry) => total + entry.snippet.length, 0)
  const visible = [...rendered.matchAll(ENTRY_HEADING_PATTERN)]

  console.log(query)
  console.log(`  API отдал ${raw.length} результатов, ${rawChars} символов content`)
  console.log(`  инструмент вернул ${rendered.length} символов за ${elapsedMs} мс`)
  console.log(`  модель видит ${visible.length} результатов с URL`)
  console.log()
}
