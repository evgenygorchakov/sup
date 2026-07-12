import { readFile as readFromDisk, stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import process from 'node:process'
import { walkFiles } from './shared.ts'

const MAX_FILE_BYTES = 5 * 1024 * 1024

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  return new RegExp(`^${escaped}$`)
}

export async function searchWithNode(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  caseSensitive: boolean,
): Promise<string> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern, caseSensitive ? '' : 'i')
  }
  catch (error) {
    return `ERROR: invalid regex: ${(error as Error).message}`
  }

  const globRegex = glob ? globToRegex(glob) : null
  const collectedMatches: string[] = []
  const workingDirectory = process.cwd()

  for await (const file of walkFiles(searchPath)) {
    if (globRegex && !globRegex.test(basename(file))) {
      continue
    }

    const fileStats = await stat(file).catch(() => null)
    if (!fileStats || fileStats.size > MAX_FILE_BYTES) {
      continue
    }

    let content: string
    try {
      content = await readFromDisk(file, 'utf8')
    }
    catch {
      continue
    }

    if (content.includes('\0')) {
      continue
    }

    const lines = content.split('\n')
    const relativePath = relative(workingDirectory, file) || file
    let lineNumber = 0
    for (const line of lines) {
      lineNumber += 1
      if (regex.test(line)) {
        collectedMatches.push(`${relativePath}:${lineNumber}:${line}`)
      }
    }
  }

  if (collectedMatches.length === 0) {
    return `No matches for "${pattern}" in ${relative(workingDirectory, searchPath) || '.'}`
  }

  return collectedMatches.join('\n')
}
