export interface ParsedFrontmatter {
  meta: Record<string, string>
  body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/
const BLOCK_SCALAR_PATTERN = /^([|>])[+-]?$/

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
    return value.slice(1, -1)
  }

  return value
}

function readBlockScalar(lines: string[], startIndex: number, style: string): { value: string, nextIndex: number } {
  const block: string[] = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() && !/^[ \t]/.test(line)) {
      break
    }
    block.push(line.trim())
    index++
  }

  while (block.length > 0 && !block[block.length - 1]) {
    block.pop()
  }

  return { value: block.join(style === '>' ? ' ' : '\n').trim(), nextIndex: index }
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const source = raw.replace(/^\uFEFF/, '')
  const match = FRONTMATTER_PATTERN.exec(source)
  if (!match) {
    return { meta: {}, body: source.trim() }
  }

  const meta: Record<string, string> = {}
  const lines = match[1]!.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index]!.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    if (!key) {
      continue
    }

    const value = trimmed.slice(separator + 1).trim()
    const blockMatch = BLOCK_SCALAR_PATTERN.exec(value)
    if (blockMatch) {
      const block = readBlockScalar(lines, index + 1, blockMatch[1]!)
      meta[key] = block.value
      index = block.nextIndex - 1
    }
    else {
      meta[key] = stripQuotes(value)
    }
  }

  return { meta, body: source.slice(match[0].length).trim() }
}
