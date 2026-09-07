import type { Heading } from '../text/headings.ts'
import type { FetchedDocument } from './document.ts'
import type { FindOutcome } from './find.ts'
import { Config } from '../../config.ts'
import { findSections } from './find.ts'

const MAX_OUTLINE_TITLE_CHARS = 80

export interface DocumentRequest {
  offset: number
  charLimit: number
  find?: string
}

function describeMissingTail(document: FetchedDocument): string {
  if (document.byteLimit >= Config.FETCH_URL_MAX_BYTES) {
    return `the download stopped at the maxBytes ceiling ${Config.FETCH_URL_MAX_BYTES}, so the tail of the page is out of reach`
  }

  return `the download stopped at maxBytes ${document.byteLimit} — repeat the call with maxBytes ${Config.FETCH_URL_MAX_BYTES} to get the rest`
}

function describeCut(document: FetchedDocument, nextOffset: number, remaining: number): string {
  if (remaining > 0) {
    const download = document.downloadCutOff
      ? `Past that, ${describeMissingTail(document)}.`
      : 'The page downloaded in full — a larger maxBytes adds nothing here, only offset moves the window.'

    return `\n…[output limit reached: ${remaining} more characters; call fetch_url with offset ${nextOffset} to continue. ${download}]`
  }

  if (document.downloadCutOff) {
    return `\n…[this is the end of what was downloaded, not the end of the page: ${describeMissingTail(document)}]`
  }

  return ''
}

function shortenTitle(title: string): string {
  return title.length <= MAX_OUTLINE_TITLE_CHARS ? title : `${title.slice(0, MAX_OUTLINE_TITLE_CHARS - 1).trimEnd()}…`
}

function outlineBlock(headings: Heading[]): string {
  const maxEntries = Config.FETCH_URL_OUTLINE_MAX_ENTRIES

  if (maxEntries <= 0 || headings.length === 0) {
    return ''
  }

  let selected = headings
  for (let deepestLevel = 5; deepestLevel >= 1 && selected.length > maxEntries; deepestLevel--) {
    const narrower = headings.filter(heading => heading.level <= deepestLevel)
    if (narrower.length === 0) {
      break
    }
    selected = narrower
  }

  const listed = selected.slice(0, maxEntries)
  const deepestShown = Math.max(...listed.map(heading => heading.level))
  const levels = deepestShown === 1 ? 'h1' : `h1–h${deepestShown}`
  const scope = listed.length < headings.length
    ? `${listed.length} of ${headings.length}, ${levels}`
    : `${headings.length}`

  const lines = listed.map(heading => `${'#'.repeat(heading.level)} ${shortenTitle(heading.title)} — offset ${heading.offset}`)

  return `\n\nSections (${scope}), read one with offset or filter them with find:\n${lines.join('\n')}`
}

function renderMatches(document: FetchedDocument, header: string[], query: string, found: FindOutcome): string {
  const shownChars = found.shown.reduce((total, section) => total + section.text.length, 0)
  const omitted = found.matchCount - found.shown.length

  header.push(`Found ${found.matchCount} of ${found.sectionCount} sections matching "${query}", showing ${found.shown.length} (${shownChars} characters of ${document.markdown.length}):`)

  const blocks = found.shown.map((section) => {
    const label = section.clipped
      ? `Section at offset ${section.offset}, cut at the output limit — continue with offset ${section.offset + section.text.length}:`
      : `Section at offset ${section.offset}:`

    return `${label}\n${section.text}`
  })

  const tail = omitted > 0
    ? `\n\n…[${omitted} more matching ${omitted === 1 ? 'section is' : 'sections are'} left out at the output limit; narrow find or read them with offset]`
    : ''

  const download = document.downloadCutOff
    ? `\n\n…[only the downloaded part of the page was searched: ${describeMissingTail(document)}]`
    : ''

  return `${header.join('\n')}\n\n${blocks.join('\n\n')}${tail}${download}`
}

export function renderDocument(document: FetchedDocument, request: DocumentRequest): string {
  const length = document.markdown.length
  const start = Math.max(0, Math.floor(request.offset))
  const query = request.find?.trim() ?? ''
  const pastEnd = start >= length && length > 0

  if (pastEnd && query === '') {
    return `Page text is ${length} characters; offset ${start} is past end.`
  }

  const header = [
    `URL: ${document.finalUrl}`,
    `Content-Type: ${document.contentType || 'unknown'}`,
    `Bytes: ${document.bytesRead}${document.downloadCutOff ? ` (download cut off at maxBytes ${document.byteLimit})` : ''}`,
  ]

  if (length === 0) {
    header.push('No readable text was extracted from this page.')
    return header.join('\n')
  }

  if (query !== '') {
    const found = findSections(document.markdown, document.headings, query, request.charLimit)
    if (found.shown.length > 0) {
      return renderMatches(document, header, query, found)
    }
    if (pastEnd) {
      header.push(`No section matches "${query}", and the page is ${length} characters, so offset ${start} is past end.`)
      return header.join('\n')
    }
    header.push(`No section matches "${query}" — showing the page from offset ${start} instead.`)
  }

  const visible = document.markdown.slice(start, start + request.charLimit)
  const end = start + visible.length
  const remaining = length - end

  header.push(`Showing characters ${start}-${end} of ${length}${remaining === 0 ? ' (end of text)' : ''}:`)

  return `${header.join('\n')}${outlineBlock(document.headings)}\n\n${visible}${describeCut(document, end, remaining)}`
}
