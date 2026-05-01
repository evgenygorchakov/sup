import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

type ResolvedPath = | { ok: true, absolute: string } | { ok: false, error: string }

const OUTPUT_CHAR_LIMIT = 20_000

export const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
])

export function truncateText(text: string, limit: number = OUTPUT_CHAR_LIMIT): string {
  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, limit)}\n...[truncated]`
}

export function resolveInsideWorkingDirectory(path: string): ResolvedPath {
  const workingDirectory = process.cwd()
  const absolute = resolve(workingDirectory, path)

  if (absolute !== workingDirectory && !absolute.startsWith(workingDirectory + sep)) {
    return { ok: false, error: `path "${path}" is outside the current working directory` }
  }

  return { ok: true, absolute }
}

export async function* walkFiles(start: string): AsyncGenerator<string> {
  const stats = await stat(start).catch(() => null)
  if (!stats) {
    return
  }

  if (stats.isFile()) {
    yield start
    return
  }

  if (!stats.isDirectory()) {
    return
  }

  const entries = await readdir(start, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue
    }

    const fullPath = join(start, entry.name)

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
    }
    else if (entry.isFile()) {
      yield fullPath
    }
  }
}
