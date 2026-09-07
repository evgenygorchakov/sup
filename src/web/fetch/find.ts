import type { Heading } from '../text/headings.ts'
import { firstMatchOffset, queryTerms, relevanceScore } from '../text/relevance.ts'

const MIN_SECTION_CHARS = 400
const SECTION_LABEL_CHARS = 48
const HEADING_SCORE_WEIGHT = 2
const CLIPPED_LEAD_SHARE = 4

export interface MatchedSection {
  offset: number
  text: string
  clipped: boolean
}

export interface FindOutcome {
  sectionCount: number
  matchCount: number
  shown: MatchedSection[]
}

interface Section {
  start: number
  end: number
  title: string
}

function splitIntoSections(markdown: string, headings: Heading[]): Section[] {
  if (headings.length === 0) {
    return [{ start: 0, end: markdown.length, title: '' }]
  }

  const sections: Section[] = []
  const first = headings[0]!

  if (first.offset > 0) {
    sections.push({ start: 0, end: first.offset, title: '' })
  }

  headings.forEach((heading, index) => {
    sections.push({
      start: heading.offset,
      end: headings[index + 1]?.offset ?? markdown.length,
      title: heading.title,
    })
  })

  return sections
}

function startOfLineBefore(text: string, index: number): number {
  const lineBreak = text.lastIndexOf('\n', index)

  return lineBreak === -1 ? 0 : lineBreak + 1
}

function clipAroundMatch(text: string, terms: string[], limit: number): { text: string, shift: number } {
  const match = firstMatchOffset(text, terms)

  if (match <= limit) {
    return { text: text.slice(0, limit), shift: 0 }
  }

  const shift = startOfLineBefore(text, match - Math.floor(limit / CLIPPED_LEAD_SHARE))

  return { text: text.slice(shift, shift + limit), shift }
}

export function findSections(markdown: string, headings: Heading[], query: string, charLimit: number): FindOutcome {
  const terms = queryTerms(query)
  const sections = splitIntoSections(markdown, headings)

  const matched = sections
    .map((section) => {
      const raw = markdown.slice(section.start, section.end)
      const text = raw.trim()

      return {
        start: section.start + (raw.length - raw.trimStart().length),
        text,
        score: relevanceScore(text, terms) + HEADING_SCORE_WEIGHT * relevanceScore(section.title, terms),
      }
    })
    .filter(candidate => candidate.score > 0 && candidate.text.length > 0)
    .sort((left, right) => right.score - left.score)

  const shown: MatchedSection[] = []
  let budget = charLimit

  for (const candidate of matched) {
    if (budget < MIN_SECTION_CHARS) {
      break
    }

    const room = budget - SECTION_LABEL_CHARS

    if (candidate.text.length <= room) {
      shown.push({ offset: candidate.start, text: candidate.text, clipped: false })
      budget = room - candidate.text.length
      continue
    }

    const clipped = clipAroundMatch(candidate.text, terms, room)
    shown.push({ offset: candidate.start + clipped.shift, text: clipped.text, clipped: true })
    budget = 0
  }

  shown.sort((left, right) => left.offset - right.offset)

  return { sectionCount: sections.length, matchCount: matched.length, shown }
}
