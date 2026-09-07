import type { HtmlTag } from './tags.ts'
import { decodeHtmlEntities } from './entities.ts'
import { attributeValue, elementRange, readTagAt, removeCommentsAndDeclarations, removeElements } from './tags.ts'

export const TAGS_DROPPED_WITH_CONTENT = ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'form']

const HEADING_TAG = /^h([1-6])$/
const LANGUAGE_CLASS = /(?:^|\s)(?:language|lang|highlight|brush:)[-\s:]?([a-z0-9+#]+)/i
const INNER_CODE_TAG = /<code\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i
const URL_NEEDING_BRACKETS = /[()\s]/
const HEADER_CELL = /<th[\s>]/i
const TABLE_ROW = /<tr[\s>]/gi
const BLOCK_INSIDE_CELL = /<(?:table|div|p|ul|ol|section|article)[\s>]/i
const BACKTICK_RUNS = /`+/g

const MIN_FENCE_LENGTH = 3

const PARAGRAPH_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'details', 'summary', 'fieldset', 'legend', 'hgroup', 'body'])
const ROW_GROUP_TAGS = new Set(['thead', 'tbody', 'tfoot'])
const IGNORED_TAGS = new Set(['caption', 'colgroup', 'col'])

interface Sink {
  parts: string[]
  tail: string
  blank: boolean
}

interface ListLevel {
  ordered: boolean
  index: number
}

interface TableState {
  rows: number
  cells: string[]
  cellOpen: boolean
  layout: boolean
}

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function isLayoutTable(inner: string): boolean {
  if (HEADER_CELL.test(inner)) {
    return false
  }

  return BLOCK_INSIDE_CELL.test(inner) || (inner.match(TABLE_ROW)?.length ?? 0) < 2
}

function isBlank(text: string): boolean {
  return !/\S/.test(text)
}

function trailingNewlines(text: string): number {
  let count = 0
  while (count < text.length && text.charCodeAt(text.length - 1 - count) === 10) {
    count += 1
  }

  return count
}

function languageOf(attributes: string): string {
  return LANGUAGE_CLASS.exec(attributeValue(attributes, 'class'))?.[1] ?? ''
}

function resolveUrl(href: string, baseUrl?: string): string {
  try {
    return new URL(href, baseUrl).toString()
  }
  catch {
    return ''
  }
}

function renderLink(text: string, href: string, baseUrl?: string): string {
  if (text === '') {
    return ''
  }

  if (href.startsWith('#')) {
    return /[\p{L}\p{N}]/u.test(text) ? text : ''
  }

  if (href === '' || /^(?:javascript|data):/i.test(href)) {
    return text
  }

  const resolved = resolveUrl(href, baseUrl)
  if (resolved === '' || resolved.startsWith('mailto:') || resolved === text) {
    return text
  }

  return URL_NEEDING_BRACKETS.test(resolved) ? `[${text}](<${resolved}>)` : `[${text}](${resolved})`
}

function renderImage(tag: HtmlTag, baseUrl?: string): string {
  const alt = flatten(decodeHtmlEntities(attributeValue(tag.attributes, 'alt')))
  const source = decodeHtmlEntities(attributeValue(tag.attributes, 'src'))

  if (alt === '' || source === '' || source.startsWith('data:')) {
    return ''
  }

  const resolved = resolveUrl(source, baseUrl)

  return resolved === '' ? '' : `![${alt}](${URL_NEEDING_BRACKETS.test(resolved) ? `<${resolved}>` : resolved})`
}

function renderCodeBlock(code: string, language: string): string {
  let longestRun = 0
  for (const run of code.match(BACKTICK_RUNS) ?? []) {
    longestRun = Math.max(longestRun, run.length)
  }
  const fence = '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1))

  return `${fence}${language}\n${code}\n${fence}`
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const source = removeElements(removeCommentsAndDeclarations(html), tag => TAGS_DROPPED_WITH_CONTENT.includes(tag.name))

  const sinks: Sink[] = [{ parts: [], tail: '', blank: true }]
  const lists: ListLevel[] = []
  const links: string[] = []
  const headings: number[] = []
  const tables: TableState[] = []
  let pendingLanguage = ''

  const top = (): Sink => sinks[sinks.length - 1]!
  const append = (text: string): void => {
    if (text === '') {
      return
    }

    const sink = top()
    sink.parts.push(text)
    sink.tail = (sink.tail + text).slice(-4)
    if (sink.blank && !isBlank(text)) {
      sink.blank = false
    }
  }
  const push = (): void => {
    sinks.push({ parts: [], tail: '', blank: true })
  }
  const pop = (): string => (sinks.length > 1 ? sinks.pop()!.parts.join('') : '')

  const writeInline = (text: string): void => {
    if (text === '') {
      return
    }

    const sink = top()
    if (text === ' ') {
      if (sink.parts.length > 0 && !sink.tail.endsWith(' ') && !sink.tail.endsWith('\n')) {
        append(' ')
      }
      return
    }

    append(sink.parts.length === 0 || sink.tail.endsWith('\n') ? text.replace(/^ +/, '') : text)
  }

  const writeText = (raw: string): void => {
    writeInline(decodeHtmlEntities(raw).replace(/\s+/g, ' '))
  }

  const breakLine = (): void => {
    const sink = top()
    if (!sink.blank && !sink.tail.endsWith('\n')) {
      append('\n')
    }
  }

  const breakBlock = (): void => {
    const sink = top()
    if (sink.blank) {
      return
    }

    const trailing = trailingNewlines(sink.tail)
    if (trailing < 2) {
      append('\n'.repeat(2 - trailing))
    }
  }

  const breakParagraph = (): void => {
    if (lists.length > 0) {
      writeInline(' ')
      return
    }

    breakBlock()
  }

  const closeTableCell = (table: TableState): void => {
    if (!table.cellOpen) {
      return
    }

    table.cellOpen = false
    table.cells.push(flatten(pop()))
  }

  const closeTableRow = (table: TableState): void => {
    closeTableCell(table)
    if (table.cells.length === 0) {
      return
    }

    breakLine()
    append(`| ${table.cells.join(' | ')} |\n`)
    if (table.rows === 0) {
      append(`|${table.cells.map(() => ' --- ').join('|')}|\n`)
    }
    table.rows += 1
    table.cells = []
  }

  const handleOpen = (tag: HtmlTag): number => {
    const language = languageOf(tag.attributes)
    if (language !== '') {
      pendingLanguage = language
    }

    const headingLevel = HEADING_TAG.exec(tag.name)?.[1]
    if (headingLevel) {
      breakBlock()
      headings.push(Number(headingLevel))
      push()
      return tag.end
    }

    switch (tag.name) {
      case 'br':
        breakLine()
        return tag.end

      case 'hr':
        breakBlock()
        append('---')
        breakBlock()
        return tag.end

      case 'img':
        writeInline(renderImage(tag, baseUrl))
        return tag.end

      case 'a':
        links.push(decodeHtmlEntities(attributeValue(tag.attributes, 'href')))
        push()
        return tag.end

      case 'code':
        push()
        return tag.end

      case 'pre': {
        const range = elementRange(source, tag)
        const inner = source.slice(range.contentStart, range.contentEnd)
        const innerLanguage = languageOf(INNER_CODE_TAG.exec(inner)?.[1] ?? '')
        const code = decodeHtmlEntities(inner.replace(/<br\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''))
          .replace(/^[ \t]*\n/, '')
          .replace(/\s+$/, '')

        if (code !== '') {
          breakBlock()
          append(renderCodeBlock(code, innerLanguage || languageOf(tag.attributes) || pendingLanguage))
          breakBlock()
        }
        pendingLanguage = ''
        return range.end
      }

      case 'ul':
      case 'ol':
        if (lists.length > 0) {
          breakLine()
        }
        else {
          breakBlock()
        }
        lists.push({ ordered: tag.name === 'ol', index: 0 })
        return tag.end

      case 'li': {
        breakLine()
        const level = lists[lists.length - 1]
        const marker = level?.ordered ? `${level.index += 1}. ` : '- '
        append('  '.repeat(Math.max(0, lists.length - 1)) + marker)
        return tag.end
      }

      case 'table': {
        const range = elementRange(source, tag)
        breakBlock()
        tables.push({ rows: 0, cells: [], cellOpen: false, layout: isLayoutTable(source.slice(range.contentStart, range.contentEnd)) })
        return tag.end
      }

      case 'tr': {
        const table = tables[tables.length - 1]
        if (table?.layout === false) {
          closeTableRow(table)
        }
        else {
          breakBlock()
        }
        return tag.end
      }

      case 'td':
      case 'th': {
        const table = tables[tables.length - 1]
        if (table && !table.layout) {
          closeTableCell(table)
          table.cellOpen = true
          push()
        }
        else {
          breakLine()
        }
        return tag.end
      }

      case 'blockquote':
        breakBlock()
        push()
        return tag.end

      default:
        if (PARAGRAPH_TAGS.has(tag.name)) {
          breakParagraph()
        }
        return tag.end
    }
  }

  const handleClose = (tag: HtmlTag): number => {
    const headingLevel = HEADING_TAG.exec(tag.name)?.[1]
    if (headingLevel) {
      const title = flatten(pop())
      const level = headings.pop() ?? Number(headingLevel)
      if (title !== '') {
        writeInline(links.length > 0 ? `${title} ` : `${'#'.repeat(level)} ${title}`)
        breakBlock()
      }
      return tag.end
    }

    switch (tag.name) {
      case 'a': {
        const text = flatten(pop())
        writeInline(renderLink(text, links.pop() ?? '', baseUrl))
        return tag.end
      }

      case 'code': {
        const text = flatten(pop())
        if (text !== '') {
          writeInline(text.includes('`') ? text : `\`${text}\``)
        }
        return tag.end
      }

      case 'ul':
      case 'ol':
        lists.pop()
        if (lists.length === 0) {
          breakBlock()
        }
        return tag.end

      case 'li':
        breakLine()
        return tag.end

      case 'td':
      case 'th': {
        const table = tables[tables.length - 1]
        if (table && !table.layout) {
          closeTableCell(table)
        }
        return tag.end
      }

      case 'tr': {
        const table = tables[tables.length - 1]
        if (table) {
          closeTableRow(table)
        }
        return tag.end
      }

      case 'table': {
        const table = tables[tables.length - 1]
        if (table) {
          closeTableRow(table)
          tables.pop()
        }
        breakBlock()
        return tag.end
      }

      case 'blockquote': {
        const quoted = pop().trim().split('\n').map(line => `> ${line}`.trimEnd()).join('\n')
        if (quoted !== '>') {
          breakBlock()
          append(quoted)
          breakBlock()
        }
        return tag.end
      }

      default:
        if (PARAGRAPH_TAGS.has(tag.name)) {
          breakParagraph()
        }
        return tag.end
    }
  }

  let index = 0
  while (index < source.length) {
    const lessThan = source.indexOf('<', index)
    if (lessThan === -1) {
      writeText(source.slice(index))
      break
    }

    if (lessThan > index) {
      writeText(source.slice(index, lessThan))
    }

    const tag = readTagAt(source, lessThan)
    if (!tag) {
      writeText('<')
      index = lessThan + 1
      continue
    }

    if (IGNORED_TAGS.has(tag.name)) {
      index = tag.end
      continue
    }

    if (ROW_GROUP_TAGS.has(tag.name)) {
      const table = tables[tables.length - 1]
      if (table) {
        closeTableRow(table)
      }
      index = tag.end
      continue
    }

    index = tag.closing ? handleClose(tag) : handleOpen(tag)
  }

  while (sinks.length > 1) {
    const leftover = pop()
    append(leftover)
  }

  return sinks[0]!.parts.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
