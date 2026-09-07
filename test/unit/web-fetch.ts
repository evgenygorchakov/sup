/** fetch_url: how it windows a long page, maps its sections, answers a find query, tells the
 *  two truncations apart and caches what it downloaded. No network — every check runs on
 *  hand-made data. Run with: node test/run.ts (or node test/unit/web-fetch.ts). */
import { check, done } from '../lib/check.ts'
import { Config } from '../../src/config.ts'
import { OUTPUT_CHAR_LIMIT } from '../../src/tools/list/shared.ts'
import { clearDocumentCache, documentCacheKey, readCachedDocument, writeCachedDocument } from '../../src/web/fetch/cache.ts'
import { renderDocument } from '../../src/web/fetch/render.ts'
import { collectHeadings } from '../../src/web/text/headings.ts'

const ceiling = Config.FETCH_URL_MAX_BYTES

function document(overrides: Partial<Parameters<typeof renderDocument>[0]> = {}): Parameters<typeof renderDocument>[0] {
  return {
    finalUrl: 'https://example.com/doc',
    contentType: 'text/html',
    bytesRead: 1234,
    byteLimit: ceiling,
    downloadCutOff: false,
    markdown: 'short body',
    headings: [],
    ...overrides,
  }
}

function read(page: Parameters<typeof renderDocument>[0], offset = 0, find?: string): string {
  return renderDocument(page, { offset, charLimit: OUTPUT_CHAR_LIMIT, find })
}

const longText = 'x'.repeat(OUTPUT_CHAR_LIMIT + 5000)

// --- a page that fits: no continuation note, and the header says where the text ends
const whole = read(document(), 0)
check('whole page: header lines', whole.split('\n\n')[0]?.split('\n'), [
  'URL: https://example.com/doc',
  'Content-Type: text/html',
  'Bytes: 1234',
  'Showing characters 0-10 of 10 (end of text):',
])
check('whole page: body is the text', whole.endsWith('\n\nshort body'), true)

// --- text longer than the window: continue with offset, and maxBytes is explicitly not the fix
const windowed = read(document({ markdown: longText, bytesRead: 60_000 }), 0)
const windowedBody = windowed.slice(windowed.indexOf('\n\n') + 2, windowed.indexOf('\n…['))
check('long text: window is one output limit', windowedBody.length, OUTPUT_CHAR_LIMIT)
check('long text: says how much is left', windowed.includes('output limit reached: 5000 more characters'), true)
check('long text: hands over the next offset', windowed.includes(`call fetch_url with offset ${OUTPUT_CHAR_LIMIT} to continue`), true)
check('long text: a bigger maxBytes is ruled out', windowed.includes('a larger maxBytes adds nothing here'), true)
check('long text: does not talk about a cut-off download', windowed.includes('download cut off'), false)

// --- the same page read on from the reported offset
const second = read(document({ markdown: longText, bytesRead: 60_000 }), OUTPUT_CHAR_LIMIT)
check('offset: header counts from the offset', second.includes(`Showing characters ${OUTPUT_CHAR_LIMIT}-${longText.length} of ${longText.length} (end of text)`), true)
check('offset: no further continuation', second.includes('output limit reached'), false)

// --- download stopped early, text fits: the fix is a bigger maxBytes, not an offset
const cutOff = read(document({ markdown: 'partial body', bytesRead: 50_000, byteLimit: 50_000, downloadCutOff: true }), 0)
check('cut-off download: header marks it', cutOff.includes('Bytes: 50000 (download cut off at maxBytes 50000)'), true)
check('cut-off download: names the end of the download', cutOff.includes('this is the end of what was downloaded, not the end of the page'), true)
check('cut-off download: asks for a bigger maxBytes', cutOff.includes(`repeat the call with maxBytes ${ceiling}`), true)
check('cut-off download: no offset advice', cutOff.includes('offset'), false)

// --- both limits at once: offset moves the window, maxBytes reaches the missing tail
const both = read(document({ markdown: longText, bytesRead: 50_000, byteLimit: 50_000, downloadCutOff: true }), 0)
check('both limits: offset continues the window', both.includes(`call fetch_url with offset ${OUTPUT_CHAR_LIMIT} to continue`), true)
check('both limits: and maxBytes gets the rest', both.includes(`Past that, the download stopped at maxBytes 50000 — repeat the call with maxBytes ${ceiling}`), true)

// --- at the byte ceiling there is nothing left to raise
const atCeiling = read(document({ markdown: 'partial body', bytesRead: ceiling, byteLimit: ceiling, downloadCutOff: true }), 0)
check('ceiling: says the tail is unreachable', atCeiling.includes(`the maxBytes ceiling ${ceiling}, so the tail of the page is out of reach`), true)
check('ceiling: does not ask for a bigger maxBytes', atCeiling.includes('repeat the call with maxBytes'), false)

// --- degenerate windows
check('offset past end', read(document(), 99), 'Page text is 10 characters; offset 99 is past end.')
check('empty text is named as such', read(document({ markdown: '' }), 0).endsWith('No readable text was extracted from this page.'), true)

// --- headings come off the finished markdown, and fenced code is not a heading
const manual = [
  '# Client guide',
  '',
  'The client speaks HTTP and nothing else.',
  '',
  '## Connecting',
  '',
  'Open a socket, then send the handshake.',
  '',
  '```python',
  '# a comment is not a heading',
  'connect(timeout=30)',
  '```',
  '',
  '## Timeouts',
  '',
  'A connection timeout aborts the handshake; a read timeout aborts the response.',
  '',
  '### Retrying after a timeout',
  '',
  'Retry twice, then give up.',
  '',
  '## Logging',
  '',
  'Every request is logged.',
].join('\n')

const manualHeadings = collectHeadings(manual)
check('headings: levels and titles', manualHeadings.map(heading => `h${heading.level} ${heading.title}`), [
  'h1 Client guide',
  'h2 Connecting',
  'h2 Timeouts',
  'h3 Retrying after a timeout',
  'h2 Logging',
])
check('headings: a comment inside a fence is not one', manualHeadings.some(heading => heading.title.includes('comment')), false)
check('headings: the offset points at the heading line', manual.startsWith('## Timeouts', manualHeadings[2]!.offset), true)
check('headings: plain text has none', collectHeadings('no structure here\njust two lines'), [])

const headingTitles = (markdown: string): string[] => collectHeadings(markdown).map(heading => heading.title)
check('headings: a shorter fence inside a longer one does not close it', headingTitles(['# Syntax', '', '````', '```js', '# not a heading', '````', '', '## Lists'].join('\n')), ['Syntax', 'Lists'])
check('headings: a fence closes only on its own marker', headingTitles(['```', '~~~', '# not a heading', '```', '', '## Lists'].join('\n')), ['Lists'])
check('headings: a line with a language is not a closing fence', headingTitles(['```', '```js', '# not a heading', '```', '', '## Lists'].join('\n')), ['Lists'])

// --- the section map: every heading while they fit, a whole shallower level when they do not
const mapped = document({ markdown: manual, headings: manualHeadings })

const outlined = read(mapped)
check('outline: counts the headings', outlined.includes('Sections (5), read one with offset or filter them with find:'), true)
check('outline: one line per heading with its offset', outlined.includes(`## Timeouts — offset ${manualHeadings[2]!.offset}`), true)
check('outline: stands between the header and the text', outlined.indexOf('Sections (5)') > outlined.indexOf('Showing characters'), true)

const outlineOf = (page: Parameters<typeof renderDocument>[0]): string => read(page).split('\n\n')[1] ?? ''

Config.FETCH_URL_OUTLINE_MAX_ENTRIES = 4
check('outline: too many headings drop the deepest level', outlineOf(mapped).startsWith('Sections (4 of 5, h1–h2),'), true)
check('outline: and the deepest heading is not listed', outlineOf(mapped).includes('### Retrying'), false)

Config.FETCH_URL_OUTLINE_MAX_ENTRIES = 3
check('outline: one level left is named without a range', outlineOf(mapped).startsWith('Sections (1 of 5, h1),'), true)

Config.FETCH_URL_OUTLINE_MAX_ENTRIES = 0
check('outline: zero entries hide it', read(mapped).includes('Sections ('), false)
Config.FETCH_URL_OUTLINE_MAX_ENTRIES = 60

// --- find: the sections about the query instead of the first window
const found = read(mapped, 0, 'connection timeout')
check('find: says how many sections matched', found.includes('Found 3 of 5 sections matching "connection timeout", showing 3'), true)
check('find: no window header', found.includes('Showing characters'), false)
check('find: labels each section with its offset', [...found.matchAll(/^Section at offset (\d+):$/gm)].map(match => Number(match[1])), [
  manualHeadings[1]!.offset,
  manualHeadings[2]!.offset,
  manualHeadings[3]!.offset,
])
check('find: sections arrive in reading order', found.indexOf('## Timeouts') < found.indexOf('### Retrying'), true)
check('find: an unrelated section is left out', found.includes('Every request is logged'), false)
check('find: a stale offset does not block the search', read(mapped, 99_999, 'connection timeout').includes('Found 3 of 5 sections matching'), true)
check('find: a miss past the end names both', read(mapped, 99_999, 'kubernetes').endsWith(`No section matches "kubernetes", and the page is ${manual.length} characters, so offset 99999 is past end.`), true)

const missed = read(mapped, 0, 'kubernetes')
check('find: no match is said out loud', missed.includes('No section matches "kubernetes" — showing the page from offset 0 instead.'), true)
check('find: and the usual window follows', missed.includes('Showing characters 0-'), true)

// --- find under a tight output limit: what fits, what is cut, what is left over
const padded = ['', '', '', '', '', ''].map((_, index) => `## Section ${index}\n\n${index % 2 === 0 ? 'A timeout ends the call. ' : 'Nothing to see here. '.repeat(1)}${'filler words here. '.repeat(30)}`).join('\n\n')
const paddedDocument = document({ markdown: padded, headings: collectHeadings(padded) })
const tight = renderDocument(paddedDocument, { offset: 0, charLimit: 1200, find: 'timeout' })
check('find: fills the limit with whole sections first', tight.includes('Found 3 of 6 sections matching "timeout", showing 2'), true)
check('find: the last section is cut and says where to go on', /Section at offset \d+, cut at the output limit — continue with offset \d+:/.test(tight), true)
check('find: the leftovers are named', tight.includes('…[1 more matching section is left out at the output limit; narrow find or read them with offset]'), true)
check('find: the output stays inside the limit', tight.length < 1200 + 400, true)

// --- the cache: same url and byte limit hit, a different byte limit misses
clearDocumentCache()
const key = documentCacheKey('https://example.com/doc', ceiling)
writeCachedDocument(key, document({ markdown: 'cached body' }))
check('cache: hit returns the document', readCachedDocument(key)?.markdown, 'cached body')
check('cache: another byte limit is another entry', readCachedDocument(documentCacheKey('https://example.com/doc', 50_000)), null)
check('cache: another url is another entry', readCachedDocument(documentCacheKey('https://example.com/other', ceiling)), null)

// --- the cache: a character budget on top of the entry count, so 2 MB pages cannot pile up
clearDocumentCache()
const budgetKeys = ['first', 'second'].map(name => documentCacheKey(`https://example.com/${name}`, ceiling))
for (const budgetKey of budgetKeys) {
  writeCachedDocument(budgetKey, document({ markdown: 'y'.repeat(3_000_000) }))
}
check('cache: the character budget drops the oldest page', readCachedDocument(budgetKeys[0]!), null)
check('cache: and keeps the newest', readCachedDocument(budgetKeys[1]!)?.markdown.length, 3_000_000)

clearDocumentCache()
const hugeKey = documentCacheKey('https://example.com/huge', ceiling)
writeCachedDocument(hugeKey, document({ markdown: 'z'.repeat(5_000_000) }))
check('cache: a page over the budget on its own stays, so its offset re-reads cost nothing', readCachedDocument(hugeKey)?.markdown.length, 5_000_000)
clearDocumentCache()
Config.FETCH_URL_CACHE_TTL_MS = 0
clearDocumentCache()
writeCachedDocument(key, document({ markdown: 'cached body' }))
check('cache: a zero ttl stores nothing', readCachedDocument(key), null)
Config.FETCH_URL_CACHE_TTL_MS = 900_000

done()
