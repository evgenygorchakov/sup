import { readFile } from 'node:fs/promises'
import { Config, resolveFromInstallDir } from '../config.ts'
import { yellow } from '../utils/colors.ts'

interface Substitution {
  pattern: RegExp
  spoken: string
  keepsSuffix: boolean
}

const COMMENT = /^\s*#/
const PATTERN_SPECIALS = /[.*+?^${}()|[\]\\]/g
const SUFFIX_MARK = '*'

let substitutions: Substitution[] = []

function escapeForPattern(text: string): string {
  return text.replace(PATTERN_SPECIALS, '\\$&')
}

function parseEntry(line: string): { written: string, spoken: string } | null {
  const separator = line.indexOf('=')
  if (separator < 0) {
    return null
  }
  const written = line.slice(0, separator).trim()
  return written ? { written, spoken: line.slice(separator + 1).trim() } : null
}

function compile(written: string): Omit<Substitution, 'spoken'> | null {
  const keepsSuffix = written.endsWith(SUFFIX_MARK)
  const stem = keepsSuffix ? written.slice(0, -SUFFIX_MARK.length) : written
  if (!stem) {
    return null
  }
  const boundary = keepsSuffix ? '(\\p{L}*)' : '(?!\\p{L})'
  return { pattern: new RegExp(`(?<!\\p{L})${escapeForPattern(stem)}${boundary}`, 'giu'), keepsSuffix }
}

export async function loadPronunciations(): Promise<number> {
  if (!Config.TTS_LEXICON_FILE) {
    return 0
  }
  const filePath = resolveFromInstallDir(Config.TTS_LEXICON_FILE)
  let fileContent: string
  try {
    fileContent = await readFile(filePath, 'utf8')
  }
  catch {
    console.warn(yellow(`⚠  TTS_LEXICON_FILE not readable, speaking every word as written: ${filePath}`))
    return 0
  }

  const parsed: Substitution[] = []
  for (const line of fileContent.split('\n')) {
    if (!line.trim() || COMMENT.test(line)) {
      continue
    }
    const entry = parseEntry(line)
    const compiled = entry ? compile(entry.written) : null
    if (!entry || !compiled) {
      console.warn(yellow(`⚠  TTS_LEXICON_FILE line ignored, expected "written = spoken": ${line.trim()}`))
      continue
    }
    parsed.push({ ...compiled, spoken: entry.spoken })
  }

  substitutions = parsed
  return parsed.length
}

export function applyPronunciations(text: string): string {
  return substitutions.reduce(
    (spoken, entry) => spoken.replace(entry.pattern, (...match: unknown[]) =>
      entry.keepsSuffix ? `${entry.spoken}${match[1] as string}` : entry.spoken),
    text,
  )
}
