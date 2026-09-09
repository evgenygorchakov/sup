export const VERIFICATION_HEADINGS = ['verification', 'проверка', 'верификация'] as const

const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(\S.*)$/
const BOLD_MARKERS = ['**', '__'] as const
const BOLD_HEADING_LEVEL = 7

function normalizeHeading(text: string): string {
  return text.replace(/[*_:`]/g, '').trim().toLowerCase()
}

interface HeadingInfo {
  key: string
  level: number
}

function headingInfo(line: string): HeadingInfo | null {
  const trimmed = line.trim()

  const headingMatch = MARKDOWN_HEADING.exec(trimmed)
  if (headingMatch) {
    return { key: normalizeHeading(headingMatch[2]!), level: headingMatch[1]!.length }
  }

  for (const marker of BOLD_MARKERS) {
    if (!trimmed.startsWith(marker)) {
      continue
    }
    const withoutColon = trimmed.endsWith(':') ? trimmed.slice(0, -1) : trimmed
    if (withoutColon.length > marker.length * 2 && withoutColon.endsWith(marker)) {
      const text = withoutColon.slice(marker.length, -marker.length)
      if (text.trim()) {
        return { key: normalizeHeading(text), level: BOLD_HEADING_LEVEL }
      }
    }
  }
  return null
}

export function findSection(markdown: string, names: readonly string[]): string | null {
  const targets = names.map(name => name.toLowerCase())
  const lines = markdown.split('\n')
  const buffer: string[] = []
  let captureLevel: number | null = null
  let inFence = false

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence
      if (captureLevel !== null) {
        buffer.push(line)
      }
      continue
    }
    const heading = inFence ? null : headingInfo(line)
    if (captureLevel === null) {
      if (heading && targets.some(target => heading.key.startsWith(target))) {
        captureLevel = heading.level
      }
      continue
    }
    if (heading && heading.level <= captureLevel) {
      break
    }
    buffer.push(line)
  }

  const body = buffer.join('\n').trim()
  return body || null
}
