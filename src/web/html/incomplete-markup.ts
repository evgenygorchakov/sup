const TAGS_WHOSE_OPEN_TAIL_BREAKS_PARSING = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form', 'pre']

export function discardIncompleteTrailingMarkup(html: string): string {
  let cutAt = html.length

  for (const tag of TAGS_WHOSE_OPEN_TAIL_BREAKS_PARSING) {
    let lastOpeningIndex = -1
    for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))) {
      lastOpeningIndex = match.index
    }
    if (lastOpeningIndex === -1) {
      continue
    }
    if (!new RegExp(`</${tag}\\s*>`, 'i').test(html.slice(lastOpeningIndex))) {
      cutAt = Math.min(cutAt, lastOpeningIndex)
    }
  }

  const kept = html.slice(0, cutAt)
  const lastOpeningBracket = kept.lastIndexOf('<')
  const lastClosingBracket = kept.lastIndexOf('>')

  return lastOpeningBracket > lastClosingBracket ? kept.slice(0, lastOpeningBracket) : kept
}
