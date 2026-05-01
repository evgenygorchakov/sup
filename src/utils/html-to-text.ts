const TAGS_TO_REMOVE_WITH_CONTENT = ['script', 'style', 'noscript', 'nav', 'footer', 'form', 'header', 'aside', 'svg']

const BLOCK_CLOSING_TAGS = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article']

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
}

export function htmlToText(html: string): string {
  let text = html

  for (const tag of TAGS_TO_REMOVE_WITH_CONTENT) {
    const blockPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
    text = text.replace(blockPattern, '')
  }

  text = text.replace(/<br\s*\/?>/gi, '\n')
  for (const tag of BLOCK_CLOSING_TAGS) {
    const closingPattern = new RegExp(`</${tag}\\s*>`, 'gi')
    text = text.replace(closingPattern, '\n')
  }

  text = text.replace(/<!--[\s\S]*?-->/g, '')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeHtmlEntities(text)

  return text
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, digits: string) => safeFromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (fullMatch, name: string) => NAMED_HTML_ENTITIES[name.toLowerCase()] ?? fullMatch)
}

function safeFromCodePoint(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
    return ''
  }
  try {
    return String.fromCodePoint(codePoint)
  }
  catch {
    return ''
  }
}
