import type { LookupAddress } from 'node:dns'
import type { IncomingMessage } from 'node:http'
import type { LookupFunction } from 'node:net'
import type { FetchedDocument } from './document.ts'
import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Config } from '../../config.ts'
import { resolveAndCheckPublicHost } from '../../utils/private-host.ts'
import { selectContentRoot } from '../html/content-root.ts'
import { discardIncompleteTrailingMarkup } from '../html/incomplete-markup.ts'
import { htmlToMarkdown } from '../html/markdown.ts'
import { collectHeadings } from '../text/headings.ts'

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) sup-evgen/0.1'
const SUPPORTED_CONTENT_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xml', 'application/xhtml+xml']
const MAX_REDIRECTS = 5

interface RawResponse {
  status: number
  statusText: string
  contentType: string
  location: string | null
  stream: IncomingMessage
}

type SafeFetchResult = | { ok: true, response: RawResponse, finalUrl: URL } | { ok: false, error: string }

export type DownloadResult = | { ok: true, document: FetchedDocument } | { ok: false, error: string }

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

export async function downloadDocument(url: URL, byteLimit: number): Promise<DownloadResult> {
  const fetchResult = await followRedirectsSafely(url)
  if (!fetchResult.ok) {
    return { ok: false, error: fetchResult.error }
  }

  const { response, finalUrl } = fetchResult

  if (response.status < 200 || response.status >= 300) {
    response.stream.destroy()
    return { ok: false, error: `HTTP ${response.status} ${response.statusText}` }
  }

  const contentType = response.contentType
  if (contentType && !SUPPORTED_CONTENT_TYPES.some(type => contentType.startsWith(type))) {
    response.stream.destroy()
    return { ok: false, error: `unsupported content-type "${contentType}"` }
  }

  let bounded: { text: string, bytesRead: number, truncated: boolean }
  try {
    bounded = await readBoundedText(response.stream, byteLimit)
  }
  catch (error) {
    return { ok: false, error: (error as Error).message }
  }

  const { text: rawText, bytesRead, truncated } = bounded
  const isHtmlContent = contentType.startsWith('text/html') || contentType.startsWith('application/xhtml')
  const completeMarkup = isHtmlContent && truncated ? discardIncompleteTrailingMarkup(rawText) : rawText

  const markdown = isHtmlContent ? htmlToMarkdown(selectContentRoot(completeMarkup), finalUrl.toString()) : completeMarkup

  return {
    ok: true,
    document: {
      finalUrl: finalUrl.toString(),
      contentType,
      bytesRead,
      byteLimit,
      downloadCutOff: truncated,
      markdown,
      headings: collectHeadings(markdown),
    },
  }
}
