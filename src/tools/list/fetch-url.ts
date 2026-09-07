import type { Tool } from '../../types.ts'
import { Config } from '../../config.ts'
import { cyan } from '../../utils/colors.ts'
import { documentCacheKey, readCachedDocument, writeCachedDocument } from '../../web/fetch/cache.ts'
import { downloadDocument } from '../../web/fetch/download.ts'
import { renderDocument } from '../../web/fetch/render.ts'
import { OUTPUT_CHAR_LIMIT } from './shared.ts'

const PREVIEW_LINE_COUNT = 3

export const fetchUrl: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetches a public HTTP(S) page and returns it as markdown: headings, lists, tables, code blocks and links are kept, scripts, styles and navigation are dropped. Blocks localhost and private network ranges. A long page arrives one window at a time, with a map of its sections and their offsets, so the next call can jump straight to the part you need. USE WHEN: you need the contents of a specific public web page whose URL you already know (often after web_search). DO NOT USE FOR: running curl/wget through run_shell, fetching localhost or private hosts (blocked), or general web search when the URL is unknown (use web_search first). EXAMPLE: {"url": "https://example.com/docs"}, {"url": "https://example.com/docs", "find": "connection timeout"} for the sections about that, or {"url": "https://example.com/docs", "offset": 20000} to read on from where the previous call stopped.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute http:// or https:// URL to fetch.',
          },
          maxBytes: {
            type: 'number',
            description: `Upper bound on the number of bytes to download. Capped at ${Config.FETCH_URL_MAX_BYTES}. Raise it only when the reply says the download was cut off.`,
          },
          offset: {
            type: 'number',
            description: 'Where the returned window starts, in characters of the extracted text. Defaults to 0. Pass the offset the previous call reported, or one from the section map, to read that part; this does not re-download the page.',
          },
          find: {
            type: 'string',
            description: 'Words to look for: the reply then holds the sections of the page that mention them instead of the first window, e.g. "connection timeout".',
          },
        },
        required: ['url'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { url?: unknown, maxBytes?: unknown, offset?: unknown, find?: unknown }

    if (typeof args.url !== 'string' || args.url.length === 0) {
      return 'ERROR: fetch_url expects { url: string, maxBytes?: number, offset?: number, find?: string }'
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(args.url)
    }
    catch {
      return `ERROR: invalid URL: ${args.url}`
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return `ERROR: unsupported protocol ${parsedUrl.protocol} (only http and https are allowed)`
    }

    const requestedMaxBytes = typeof args.maxBytes === 'number' ? args.maxBytes : Config.FETCH_URL_MAX_BYTES
    const byteLimit = Math.max(1024, Math.min(Config.FETCH_URL_MAX_BYTES, requestedMaxBytes))
    const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0
    const request = {
      offset,
      charLimit: OUTPUT_CHAR_LIMIT,
      find: typeof args.find === 'string' ? args.find : undefined,
    }

    const cacheKey = documentCacheKey(parsedUrl.toString(), byteLimit)
    const cached = readCachedDocument(cacheKey)
    if (cached) {
      return renderDocument(cached, request)
    }

    const downloaded = await downloadDocument(parsedUrl, byteLimit)
    if (!downloaded.ok) {
      return `ERROR: ${downloaded.error}`
    }

    writeCachedDocument(cacheKey, downloaded.document)

    return renderDocument(downloaded.document, request)
  },
  primaryArgs: ['url', 'find', 'offset'],
  accentColor: cyan,
  renderResult: (args, result) => {
    if (!result.startsWith('URL: ')) {
      return result
    }

    const url = typeof args.url === 'string' ? args.url : ''
    let hostname = url
    try {
      hostname = new URL(url).hostname
    }
    catch {
      hostname = url
    }

    const firstBlankLineIndex = result.indexOf('\n\n')
    const metadata = firstBlankLineIndex === -1 ? result : result.slice(0, firstBlankLineIndex)
    const body = firstBlankLineIndex === -1 ? '' : result.slice(firstBlankLineIndex + 2)

    const bytes = metadata.match(/^Bytes: (\d+)/m)?.[1] ?? ''
    const matched = metadata.match(/^Found (\d+) of \d+ sections matching (".*?"),/m)
    const shown = metadata.match(/^Showing characters (\d+)-(\d+) of (\d+)/m)
    const windowNote = matched
      ? ` (${matched[1]} sections matching ${matched[2]})`
      : shown && (shown[1] !== '0' || shown[2] !== shown[3])
        ? ` (chars ${shown[1]}–${shown[2]} of ${shown[3]})`
        : ''

    const previewLines = body
      .split('\n')
      .filter(line => line.trim().length > 0)
      .slice(0, PREVIEW_LINE_COUNT)
      .join('\n')

    const header = bytes ? `Fetched ${bytes} bytes from ${hostname}${windowNote}` : `Fetched from ${hostname}${windowNote}`

    return previewLines ? `${header}\n${previewLines}` : header
  },
  autoApprove: false,
}
