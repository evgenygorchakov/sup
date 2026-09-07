#!/usr/bin/env node
/** Measure what fetch_url actually delivers on real pages.
 *
 *     node test/bench/fetch-pages.ts > before.json
 *     FETCH_URL_MAX_BYTES=50000 node test/bench/fetch-pages.ts > after.json
 *
 * Prints one JSON row per URL: latency, bytes downloaded, whether the byte cap was hit,
 * how many characters of readable text one window shows and how many the whole page holds.
 */
import process from 'node:process'
import { fetchUrl } from '../../src/tools/list/fetch-url.ts'

const urls = [
  'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)',
  'https://nodejs.org/api/fs.html',
  'https://nodejs.org/en/blog/release/v26.0.0/',
  'https://nodejs.org/learn/getting-started/fetch',
  'https://docs.python.org/3/library/asyncio-task.html',
  'https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch',
  'https://github.com/nodejs/node/releases/tag/v26.0.0',
  'https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md',
  'https://api.github.com/repos/ollama/ollama',
  'https://news.ycombinator.com/',
  'https://ollama.com/blog',
  'https://habr.com/ru/articles/1021832/',
  'https://theneuralbase.com/ollama/learn/intermediate/tool-definition-format',
  'https://serverflow.ru/blog/stati/chto-takoe-kv-cache-i-kak-on-uskoryaet-llm',
  'https://24k.ru/wiki/terms/kv_cache',
  'https://www.ultralytics.com/ru/glossary/kv-cache',
]

const rows = []

for (const url of urls) {
  const startedAt = Date.now()
  const result = await fetchUrl.handler({ url })
  const elapsedMs = Date.now() - startedAt

  const failed = result.startsWith('ERROR:')
  const headerEnd = result.indexOf('\n\n')
  const header = headerEnd === -1 ? result : result.slice(0, headerEnd)
  const shown = header.match(/^Showing characters (\d+)-(\d+) of (\d+)/m)

  rows.push({
    url,
    elapsedMs,
    ok: !failed,
    error: failed ? result.slice(7, 90) : null,
    bytes: Number.parseInt(header.match(/^Bytes: (\d+)/m)?.[1] ?? '', 10) || 0,
    byteCapHit: header.includes('download cut off'),
    windowChars: shown ? Number(shown[2]) - Number(shown[1]) : 0,
    textChars: shown ? Number(shown[3]) : 0,
  })
  process.stderr.write('.')
}

process.stderr.write('\n')
console.log(JSON.stringify(rows, null, 2))
