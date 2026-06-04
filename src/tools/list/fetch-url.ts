import type { Tool } from '../../types.ts'
import { Buffer } from 'node:buffer'
import { Config } from '../../config.ts'
import { cyan } from '../../utils/colors.ts'
import { htmlToText } from '../../utils/html-to-text.ts'
import { resolveAndCheckPublicHost } from '../../utils/private-host.ts'
import { truncateText } from './shared.ts'

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) sup-evgen/0.1'
const SUPPORTED_CONTENT_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xml', 'application/xhtml+xml']
const PREVIEW_LINE_COUNT = 3
const MAX_REDIRECTS = 5

type SafeFetchResult = | { ok: true, response: Response, finalUrl: URL } | { ok: false, error: string }

async function followRedirectsSafely(initialUrl: URL): Promise<SafeFetchResult> {
  let url = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostCheck = await resolveAndCheckPublicHost(url.hostname)
    if (!hostCheck.ok) {
      return { ok: false, error: hostCheck.error }
    }

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,text/plain,application/json,application/xml;q=0.9',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(Config.FETCH_URL_TIMEOUT_MS),
      })
    }
    catch (error) {
      return { ok: false, error: (error as Error).message }
    }

    if (response.status < 300 || response.status >= 400) {
      return { ok: true, response, finalUrl: url }
    }

    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)

    if (!location) {
      return { ok: false, error: `redirect status ${response.status} without Location header` }
    }

    let nextUrl: URL
    try {
      nextUrl = new URL(location, url)
    }
    catch {
      return { ok: false, error: `invalid redirect Location: ${location}` }
    }

    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      return { ok: false, error: `unsupported redirect protocol ${nextUrl.protocol}` }
    }

    url = nextUrl
  }

  return { ok: false, error: `too many redirects (> ${MAX_REDIRECTS})` }
}

export const fetchUrl: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetches the text content of a public HTTP(S) page and returns it as plain text. HTML is stripped to readable text (scripts, styles, navigation removed). Blocks localhost and private network ranges. Honors a size and timeout limit. USE WHEN: you need the contents of a specific public web page whose URL you already know (often after web_search). DO NOT USE FOR: running curl/wget through run_shell, fetching localhost or private hosts (blocked), or general web search when the URL is unknown (use web_search first). EXAMPLE: {"url": "https://example.com/docs"}.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute http:// or https:// URL to fetch.',
          },
          maxBytes: {
            type: 'number',
            description: `Upper bound on the number of bytes to download. Capped at ${Config.FETCH_URL_MAX_BYTES}.`,
          },
        },
        required: ['url'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { url?: unknown, maxBytes?: unknown }

    if (typeof args.url !== 'string' || args.url.length === 0) {
      return 'ERROR: fetch_url expects { url: string, maxBytes?: number }'
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

    const fetchResult = await followRedirectsSafely(parsedUrl)
    if (!fetchResult.ok) {
      return `ERROR: ${fetchResult.error}`
    }

    const { response, finalUrl } = fetchResult

    if (!response.ok) {
      return `ERROR: HTTP ${response.status} ${response.statusText}`
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (contentType && !SUPPORTED_CONTENT_TYPES.some(type => contentType.startsWith(type))) {
      return `ERROR: unsupported content-type "${contentType}"`
    }

    const { text: rawText, bytesRead, truncated } = await readBoundedText(response, byteLimit)

    const isHtmlContent = contentType.startsWith('text/html') || contentType.startsWith('application/xhtml')
    const text = isHtmlContent ? htmlToText(rawText) : rawText

    const header = `URL: ${finalUrl.toString()}\nContent-Type: ${contentType || 'unknown'}\nBytes: ${bytesRead}${truncated ? ' (truncated)' : ''}\n\n`

    return truncateText(header + text)
  },
  primaryArgs: ['url'],
  accentColor: cyan,
  renderResult: (args, result) => {
    const url = typeof args.url === 'string' ? args.url : ''
    let hostname = url
    try {
      hostname = new URL(url).hostname
    }
    catch {
      hostname = url
    }

    const firstBlankLineIndex = result.indexOf('\n\n')
    const metadata = firstBlankLineIndex === -1 ? '' : result.slice(0, firstBlankLineIndex)
    const body = firstBlankLineIndex === -1 ? result : result.slice(firstBlankLineIndex + 2)

    const bytesLine = metadata.split('\n').find(line => line.startsWith('Bytes: ')) ?? ''
    const bytes = bytesLine.slice('Bytes: '.length).trim()

    const previewLines = body
      .split('\n')
      .filter(line => line.trim().length > 0)
      .slice(0, PREVIEW_LINE_COUNT)
      .join('\n')

    const header = bytes ? `Fetched ${bytes} bytes from ${hostname}` : `Fetched from ${hostname}`

    return `${header}\n${previewLines}`
  },
  autoApprove: false,
}

async function readBoundedText(response: Response, byteLimit: number): Promise<{ text: string, bytesRead: number, truncated: boolean }> {
  const reader = response.body?.getReader()

  if (!reader) {
    const fallback = await response.text()
    const limited = fallback.slice(0, byteLimit)
    return { text: limited, bytesRead: Buffer.byteLength(limited), truncated: fallback.length > limited.length }
  }

  const chunks: Buffer[] = []
  let bytesRead = 0
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (!value) {
      continue
    }

    if (bytesRead + value.byteLength > byteLimit) {
      const remaining = byteLimit - bytesRead
      if (remaining > 0) {
        chunks.push(Buffer.from(value.slice(0, remaining)))
        bytesRead += remaining
      }
      truncated = true
      await reader.cancel()
      break
    }

    chunks.push(Buffer.from(value))
    bytesRead += value.byteLength
  }

  return { text: Buffer.concat(chunks).toString('utf-8'), bytesRead, truncated }
}
