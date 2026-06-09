export interface ParsedFrontmatter {
  meta: Record<string, string>
  body: string
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
    return value.slice(1, -1)
  }

  return value
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(raw)
  if (!match) {
    return { meta: {}, body: raw.trim() }
  }

  const meta: Record<string, string> = {}

  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = stripQuotes(trimmed.slice(separator + 1).trim())
    if (key) {
      meta[key] = value
    }
  }

  return { meta, body: raw.slice(match[0].length).trim() }
}
