import type { HtmlTag } from './tags.ts'
import { TAGS_DROPPED_WITH_CONTENT } from './markdown.ts'
import { attributeValue, elementRange, isVoidTag, nextTag, removeCommentsAndDeclarations, removeElements } from './tags.ts'

const JUNK_TAGS = new Set(['nav', 'aside', 'header', 'footer'])
const JUNK_CONTAINER_TAGS = new Set(['div', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'form', 'p', 'ul', 'ol', 'dl', 'table', 'figure', 'details'])
const HEADING_TAG = /<h[1-6]\b/i
const JUNK_NAMES = /(?:^|[^a-z])(sidebar|menu|nav|toc|breadcrumb|banner|cookie|related|comment)/i
const CONTENT_NAMES = /(?:^|[^a-z])(content|main-content|article|post|body|markdown|doc)(?:[^a-z]|$)/i
const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'main', 'body', 'center', 'table', 'tbody', 'tr', 'td'])

const MIN_ROOT_TEXT_LENGTH = 200
const MAX_LINK_TEXT_SHARE = 0.5
const MAX_JUNK_PROSE_SHARE = 0.5
const DESCENT_TEXT_SHARE = 0.8
const MAX_DESCENT_DEPTH = 24

interface TextWeight {
  text: number
  linkText: number
}

interface Block {
  contentStart: number
  contentEnd: number
}

function namesOf(tag: HtmlTag): string {
  return `${attributeValue(tag.attributes, 'id')} ${attributeValue(tag.attributes, 'class')}`
}

function isJunk(html: string, tag: HtmlTag, wholeProse: number): boolean {
  if (!JUNK_CONTAINER_TAGS.has(tag.name)) {
    return false
  }

  const named = JUNK_NAMES.test(namesOf(tag))
  if (!named && !JUNK_TAGS.has(tag.name)) {
    return false
  }

  const range = elementRange(html, tag)
  const inner = html.slice(range.contentStart, range.contentEnd)

  if (!named && tag.name === 'header' && HEADING_TAG.test(inner)) {
    return false
  }

  const prose = proseLength(weigh(inner))

  return prose < MIN_ROOT_TEXT_LENGTH || prose <= MAX_JUNK_PROSE_SHARE * wholeProse
}

function withoutJunk(html: string): string {
  const wholeProse = proseLength(weigh(html))

  return removeElements(html, tag => isJunk(html, tag, wholeProse))
}

function bodyContent(html: string): string {
  let index = 0

  while (true) {
    const tag = nextTag(html, index)
    if (!tag) {
      return html
    }
    if (!tag.closing && tag.name === 'body') {
      const range = elementRange(html, tag)
      return html.slice(range.contentStart, range.contentEnd)
    }
    index = tag.end
  }
}

function weigh(html: string): TextWeight {
  let text = 0
  let linkText = 0
  let linkDepth = 0
  let index = 0

  while (true) {
    const tag = nextTag(html, index)
    const stop = tag ? tag.start : html.length

    if (stop > index) {
      const length = html.slice(index, stop).replace(/\s+/g, ' ').trim().length
      text += length
      if (linkDepth > 0) {
        linkText += length
      }
    }

    if (!tag) {
      return { text, linkText }
    }

    if (tag.name === 'a') {
      linkDepth = tag.closing ? Math.max(0, linkDepth - 1) : linkDepth + 1
    }
    index = tag.end
  }
}

function proseLength(weight: TextWeight): number {
  return weight.text - weight.linkText
}

function containerBlocks(html: string): Block[] {
  const blocks: Block[] = []
  let index = 0

  while (true) {
    const tag = nextTag(html, index)
    if (!tag) {
      return blocks
    }

    if (tag.closing || isVoidTag(tag)) {
      index = tag.end
      continue
    }

    const range = elementRange(html, tag)
    if (CONTAINER_TAGS.has(tag.name)) {
      blocks.push({ contentStart: range.contentStart, contentEnd: range.contentEnd })
    }
    index = range.end
  }
}

function taggedRoot(html: string, matches: (tag: HtmlTag) => boolean): string | null {
  let best: { html: string, prose: number } | null = null
  let index = 0

  while (true) {
    const tag = nextTag(html, index)
    if (!tag) {
      return best && best.prose >= MIN_ROOT_TEXT_LENGTH ? best.html : null
    }

    if (tag.closing || isVoidTag(tag) || !matches(tag)) {
      index = tag.end
      continue
    }

    const range = elementRange(html, tag)
    const candidate = withoutJunk(html.slice(range.contentStart, range.contentEnd))
    const prose = proseLength(weigh(candidate))
    if (!best || prose > best.prose) {
      best = { html: candidate, prose }
    }
    index = tag.end
  }
}

function densestBlock(html: string): string {
  let current = html

  for (let depth = 0; depth < MAX_DESCENT_DEPTH; depth++) {
    const whole = proseLength(weigh(current))
    if (whole === 0) {
      return current
    }

    let best: { html: string, weight: TextWeight } | null = null
    for (const block of containerBlocks(current)) {
      const inner = current.slice(block.contentStart, block.contentEnd)
      const weight = weigh(inner)
      if (!best || proseLength(weight) > proseLength(best.weight)) {
        best = { html: inner, weight }
      }
    }

    if (!best || proseLength(best.weight) < DESCENT_TEXT_SHARE * whole) {
      return current
    }
    if (best.weight.text > 0 && best.weight.linkText / best.weight.text > MAX_LINK_TEXT_SHARE) {
      return current
    }

    current = best.html
  }

  return current
}

export function selectContentRoot(html: string): string {
  const readable = removeElements(removeCommentsAndDeclarations(html), tag => TAGS_DROPPED_WITH_CONTENT.includes(tag.name))
  const body = bodyContent(readable)
  const bodyProse = proseLength(weigh(body))

  return taggedRoot(body, tag => tag.name === 'main')
    ?? taggedRoot(body, tag => attributeValue(tag.attributes, 'role') === 'main')
    ?? taggedRoot(body, tag => tag.name === 'article')
    ?? taggedRoot(body, tag => !isJunk(body, tag, bodyProse) && CONTENT_NAMES.test(namesOf(tag)))
    ?? densestBlock(withoutJunk(body))
}
