const WORD = /[\p{L}\p{N}][\p{L}\p{N}+#._-]*/gu
const MIN_TERM_LENGTH = 2

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'has', 'have', 'how', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'this', 'to', 'use', 'using', 'was', 'what', 'when', 'where',
  'which', 'with', 'why',
])

export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(WORD) ?? []
  const meaningful = words.filter(word => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word))

  return [...new Set(meaningful.length > 0 ? meaningful : words)]
}

export function countOccurrences(lowercased: string, term: string): number {
  let count = 0

  for (let index = lowercased.indexOf(term); index !== -1; index = lowercased.indexOf(term, index + term.length)) {
    count += 1
  }

  return count
}

export function relevanceScore(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0
  }

  const lowercased = text.toLowerCase()
  let matchedTerms = 0
  let frequencyWeight = 0

  for (const term of terms) {
    const hits = countOccurrences(lowercased, term)
    if (hits === 0) {
      continue
    }
    matchedTerms += 1
    frequencyWeight += 1 + Math.log2(hits)
  }

  return matchedTerms === 0 ? 0 : frequencyWeight * (matchedTerms / terms.length)
}

export function firstMatchOffset(text: string, terms: string[]): number {
  const lowercased = text.toLowerCase()
  let earliest = -1

  for (const term of terms) {
    const index = lowercased.indexOf(term)
    if (index !== -1 && (earliest === -1 || index < earliest)) {
      earliest = index
    }
  }

  return earliest
}
