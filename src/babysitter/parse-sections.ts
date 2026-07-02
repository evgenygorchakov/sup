export const STEPS_HEADINGS = ['steps', 'шаги'] as const
export const VERIFICATION_HEADINGS = ['verification', 'проверка', 'верификация'] as const

const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(\S.*)$/
const BOLD_MARKERS = ['**', '__'] as const
const BOLD_HEADING_LEVEL = 7
const LIST_ITEM = /^(?:\d+[.)]|[-*])[ \t]+(\S.*)$/
const INLINE_CODE_SPANS = /`([^`]+)`/g

const RUNNER_COMMAND = /^(?:\$\s*)?(?:npm|pnpm|yarn|bun|npx|node|deno|tsc|eslint|prettier|biome|jest|vitest|mocha|playwright|pytest|python3?|ruff|mypy|go|cargo|make|gradle|mvn|dotnet|rspec|rake|git)\b/

const MAX_COMMANDS = 12

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

export function extractSteps(stepsSection: string): string[] {
  const steps: string[] = []
  let inFence = false
  for (const raw of stepsSection.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      continue
    }
    const match = LIST_ITEM.exec(line)
    if (match) {
      const text = match[1]!.trim()
      if (text) {
        steps.push(text)
      }
    }
  }
  return steps
}

function stripShellPrompt(line: string): string {
  return line.replace(/^\$\s*/, '').trim()
}

export function extractCommands(verificationSection: string): string[] {
  const commands: string[] = []
  let inFence = false

  for (const raw of verificationSection.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!line) {
      continue
    }

    if (inFence || line.startsWith('$')) {
      const cmd = stripShellPrompt(line)
      if (cmd && RUNNER_COMMAND.test(cmd)) {
        commands.push(cmd)
      }
      continue
    }

    let foundInline = false
    for (const span of line.matchAll(INLINE_CODE_SPANS)) {
      const candidate = span[1]!.trim()
      if (RUNNER_COMMAND.test(candidate)) {
        commands.push(candidate)
        foundInline = true
      }
    }
    if (foundInline) {
      continue
    }

    const withoutBullet = line.replace(/^[-*]\s+/, '').trim()
    if (RUNNER_COMMAND.test(withoutBullet)) {
      commands.push(withoutBullet)
    }
  }

  const unique = [...new Set(commands)].filter(cmd => cmd.length > 0 && !cmd.includes('\0'))
  return unique.slice(0, MAX_COMMANDS)
}
