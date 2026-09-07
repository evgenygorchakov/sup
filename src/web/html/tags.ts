export interface HtmlTag {
  name: string
  attributes: string
  closing: boolean
  start: number
  end: number
}

export interface ElementRange {
  contentStart: number
  contentEnd: number
  end: number
}

const TAG_ANYWHERE = /<(\/?)([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const TAG_HERE = /<(\/?)([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/iy
const COMMENT = /<!--[\s\S]*?-->/g
const DECLARATION = /<[!?][^>]*>/g

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

const attributePatterns = new Map<string, RegExp>()

function tagFromMatch(match: RegExpExecArray): HtmlTag {
  return {
    name: match[2]!.toLowerCase(),
    attributes: match[3] ?? '',
    closing: match[1] === '/',
    start: match.index,
    end: match.index + match[0]!.length,
  }
}

export function nextTag(html: string, from: number): HtmlTag | null {
  TAG_ANYWHERE.lastIndex = from
  const match = TAG_ANYWHERE.exec(html)

  return match ? tagFromMatch(match) : null
}

export function readTagAt(html: string, at: number): HtmlTag | null {
  TAG_HERE.lastIndex = at
  const match = TAG_HERE.exec(html)

  return match ? tagFromMatch(match) : null
}

export function isVoidTag(tag: HtmlTag): boolean {
  return VOID_TAGS.has(tag.name)
}

export function elementRange(html: string, tag: HtmlTag): ElementRange {
  if (isVoidTag(tag)) {
    return { contentStart: tag.end, contentEnd: tag.end, end: tag.end }
  }

  let depth = 1
  let index = tag.end

  while (true) {
    const inner = nextTag(html, index)
    if (!inner) {
      return { contentStart: tag.end, contentEnd: html.length, end: html.length }
    }

    index = inner.end

    if (inner.name !== tag.name) {
      continue
    }

    if (inner.closing) {
      depth -= 1
      if (depth === 0) {
        return { contentStart: tag.end, contentEnd: inner.start, end: inner.end }
      }
    }
    else if (!isVoidTag(inner)) {
      depth += 1
    }
  }
}

export function attributeValue(attributes: string, name: string): string {
  let pattern = attributePatterns.get(name)
  if (!pattern) {
    pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
    attributePatterns.set(name, pattern)
  }

  const match = pattern.exec(attributes)

  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

export function removeCommentsAndDeclarations(html: string): string {
  return html.replace(COMMENT, '').replace(DECLARATION, '')
}

export function removeElements(html: string, shouldRemove: (tag: HtmlTag) => boolean): string {
  let kept = ''
  let index = 0

  while (true) {
    const tag = nextTag(html, index)
    if (!tag) {
      return kept + html.slice(index)
    }

    if (tag.closing || !shouldRemove(tag)) {
      kept += html.slice(index, tag.end)
      index = tag.end
      continue
    }

    kept += html.slice(index, tag.start)
    index = elementRange(html, tag).end
  }
}
