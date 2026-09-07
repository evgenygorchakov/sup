#!/usr/bin/env node
/** Measure what the html to markdown conversion keeps on real documentation pages.
 *
 *     node test/bench/extraction-gaps.ts
 *
 * Downloads each page whole, with no byte limit, so the numbers are bigger than the ones
 * test/bench/fetch-pages.ts prints through fetch_url. For every page: how many links the
 * HTML carries against how many survive into the markdown, how much structure (headings,
 * code blocks, tables) survives, how many characters stand before the first heading, and
 * how much of the first window is link text — that is the navigation the model reads first.
 */
import { OUTPUT_CHAR_LIMIT } from '../../src/tools/list/shared.ts'
import { selectContentRoot } from '../../src/web/html/content-root.ts'
import { htmlToMarkdown } from '../../src/web/html/markdown.ts'
import { collectHeadings } from '../../src/web/text/headings.ts'

const urls = [
  'https://docs.python.org/3/library/asyncio-task.html',
  'https://nodejs.org/api/fs.html',
  'https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch',
  'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)',
]

const countOf = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length

for (const url of urls) {
  const html = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()

  const startedAt = Date.now()
  const markdown = htmlToMarkdown(selectContentRoot(html), url)
  const elapsedMs = Date.now() - startedAt

  const htmlLinks = countOf(html, /<a\b[^>]*\bhref\s*=/gi)
  const htmlHeadings = countOf(html, /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)
  const markdownLinks = [...markdown.matchAll(/\[[^\]]*\]\(<?(https?:[^\s)>]+)>?\)/g)]
  const markdownHeadings = collectHeadings(markdown)

  const firstHeadingAt = markdownHeadings[0]?.offset ?? -1
  const window = markdown.slice(0, OUTPUT_CHAR_LIMIT)
  const windowLinkText = [...window.matchAll(/\[([^\]]*)\]\(/g)].reduce((total, match) => total + match[1]!.length, 0)

  console.log(new URL(url).hostname + new URL(url).pathname.slice(0, 30))
  console.log(`  html ${html.length} -> markdown ${markdown.length} за ${elapsedMs} мс`)
  console.log(`  ссылок в html: ${htmlLinks}, url'ов в markdown: ${markdownLinks.length}`)
  console.log(`  заголовков в html: ${htmlHeadings}, в markdown: ${markdownHeadings.length}, <pre>: ${countOf(html, /<pre\b/gi)} -> ${countOf(markdown, /^```/gm) / 2}, таблиц: ${countOf(html, /<table\b/gi)} -> ${countOf(markdown, /^\|( --- \|)+$/gm)}`)
  console.log(`  до первого заголовка: ${firstHeadingAt === -1 ? 'заголовков нет' : `${firstHeadingAt} символов`}, текста в ссылках в первом окне: ${Math.round(100 * windowLinkText / window.length)}%`)
  console.log(`  начало вывода: ${JSON.stringify(markdown.slice(0, 160))}`)
  console.log()
}
