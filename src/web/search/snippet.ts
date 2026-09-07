import { queryTerms, relevanceScore } from '../text/relevance.ts'

const WHITESPACE_RUN = /\s+/g
const LEAD_SHARE = 4
const WORD_BOUNDARY_REACH = 40
const MAX_HITS_PER_TERM = 20
const ELLIPSIS = '…'

function wordStartAfter(text: string, index: number): number {
  const space = text.indexOf(' ', index)

  return space === -1 || space - index > WORD_BOUNDARY_REACH ? index : space + 1
}

function wordEndBefore(text: string, index: number): number {
  const space = text.lastIndexOf(' ', index)

  return space === -1 || index - space > WORD_BOUNDARY_REACH ? index : space
}

function candidateStarts(lowercased: string, terms: string[], lead: number, lastStart: number): number[] {
  const starts = new Set<number>([0])

  for (const term of terms) {
    let hits = 0

    for (let index = lowercased.indexOf(term); index !== -1 && hits < MAX_HITS_PER_TERM; index = lowercased.indexOf(term, index + term.length)) {
      starts.add(Math.min(lastStart, Math.max(0, index - lead)))
      hits += 1
    }
  }

  return [...starts]
}

function bestWindowStart(lowercased: string, terms: string[], limit: number): number {
  const lead = Math.floor(limit / LEAD_SHARE)
  let bestStart = 0
  let bestScore = 0

  for (const start of candidateStarts(lowercased, terms, lead, lowercased.length - limit)) {
    const score = relevanceScore(lowercased.slice(start, start + limit), terms)

    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }

  return bestStart
}

export function searchExcerpt(text: string, query: string, limit: number): string {
  const flat = text.replace(WHITESPACE_RUN, ' ').trim()

  if (limit <= 0 || flat.length === 0) {
    return ''
  }

  if (flat.length <= limit) {
    return flat
  }

  const found = bestWindowStart(flat.toLowerCase(), queryTerms(query), limit)
  const start = found === 0 ? 0 : wordStartAfter(flat, found)
  const end = start + limit >= flat.length ? flat.length : wordEndBefore(flat, start + limit)

  const head = start > 0 ? ELLIPSIS : ''
  const tail = end < flat.length ? ELLIPSIS : ''

  return `${head}${flat.slice(start, end).trim()}${tail}`
}
