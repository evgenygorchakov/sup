import type { LookupAddress } from 'node:dns'
import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import type { Tool } from '../../types.ts'
import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Config } from '../../config.ts'
import { cyan } from '../../utils/colors.ts'
import { htmlToText } from '../../utils/html-to-text.ts'
import { resolveAndCheckPublicHost } from '../../utils/private-host.ts'
import { truncateText } from './shared.ts'

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) sup-evgen/0.1'
const SUPPORTED_CONTENT_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xml', 'application/xhtml+xml']
const PREVIEW_LINE_COUNT = 3
const MAX_REDIRECTS = 5

interface RawResponse {
  status: number
  statusText: string
  contentType: string
  location: string | null
  stream: IncomingMessage
}

function pinnedLookup(addresses: string[]): LookupFunction {
  const entries: LookupAddress[] = addresses.map(address => ({ address, family: isIP(address) === 6 ? 6 : 4 }))

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, entries)
      return
    }
    const first = entries[0]!
    callback(null, first.address, first.family)
  }
}

function performRequest(url: URL, addresses: string[]): Promise<RawResponse> {
  const requestImpl = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: 'GET',
      lookup: pinnedLookup(addresses),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,text/plain,application/json,application/xml;q=0.9',
      },
      signal: AbortSignal.timeout(Config.FETCH_URL_TIMEOUT_MS),
    }, (response) => {
      const rawContentType = response.headers['content-type'] ?? ''
      const location = response.headers.location
      resolve({
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? '',
        contentType: (Array.isArray(rawContentType) ? rawContentType[0] ?? '' : rawContentType).split(';')[0]!.trim().toLowerCase(),
        location: typeof location === 'string' ? location : null,
        stream: response,
      })
    })
    request.on('error', reject)
    request.end()
  })
}

type SafeFetchResult = | { ok: true, response: RawResponse, finalUrl: URL } | { ok: false, error: string }

async function followRedirectsSafely(initialUrl: URL): Promise<SafeFetchResult> {
  let url = initialUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostCheck = await resolveAndCheckPublicHost(url.hostname)
    if (!hostCheck.ok) {
      return { ok: false, error: hostCheck.error }
    }

    let response: RawResponse
    try {
      response = await performRequest(url, hostCheck.addresses)
    }
    catch (error) {
      return { ok: false, error: (error as Error).message }
    }

    if (response.status < 300 || response.status >= 400) {
      return { ok: true, response, finalUrl: url }
    }

    response.stream.destroy()

    if (!response.location) {
      return { ok: false, error: `redirect status ${response.status} without Location header` }
    }

    let nextUrl: URL
    try {
      nextUrl = new URL(response.location, url)
    }
    catch {
      return { ok: false, error: `invalid redirect Location: ${response.location}` }
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

    if (response.status < 200 || response.status >= 300) {
      response.stream.destroy()
      return `ERROR: HTTP ${response.status} ${response.statusText}`
    }

    const contentType = response.contentType
    if (contentType && !SUPPORTED_CONTENT_TYPES.some(type => contentType.startsWith(type))) {
      response.stream.destroy()
      return `ERROR: unsupported content-type "${contentType}"`
    }

    let bounded: { text: string, bytesRead: number, truncated: boolean }
    try {
      bounded = await readBoundedText(response.stream, byteLimit)
    }
    catch (error) {
      return `ERROR: ${(error as Error).message}`
    }

    const { text: rawText, bytesRead, truncated } = bounded
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

async function readBoundedText(stream: IncomingMessage, byteLimit: number): Promise<{ text: string, bytesRead: number, truncated: boolean }> {
  const chunks: Buffer[] = []
  let bytesRead = 0
  let truncated = false

  for await (const chunk of stream) {
    const buffer = chunk as Buffer
    if (bytesRead + buffer.byteLength > byteLimit) {
      const remaining = byteLimit - bytesRead
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining))
        bytesRead += remaining
      }
      truncated = true
      stream.destroy()
      break
    }

    chunks.push(buffer)
    bytesRead += buffer.byteLength
  }

  return { text: Buffer.concat(chunks).toString('utf-8'), bytesRead, truncated }
}
