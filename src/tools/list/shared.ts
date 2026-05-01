import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'

type ResolvedPath = | { ok: true, absolute: string } | { ok: false, error: string }

const OUTPUT_CHAR_LIMIT = 20_000

export const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
])

export const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/,
  /\.(pem|key|p12|pfx|crt|cer|jks|keystore)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/,
  /^\.netrc$/,
  /^credentials(\.[^/]+)?$/i,
  /^secrets?(\.[^/]+)?$/i,
  /^\.htpasswd$/,
] as const

export function isSensitiveFileName(name: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(name))
}

export function truncateText(text: string, limit: number = OUTPUT_CHAR_LIMIT): string {
  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, limit)}\n...[truncated]`
}

let cachedWorkingDirectoryRealPath: string | null = null

async function getWorkingDirectoryRealPath(): Promise<string> {
  if (cachedWorkingDirectoryRealPath !== null) {
    return cachedWorkingDirectoryRealPath
  }

  cachedWorkingDirectoryRealPath = await realpath(process.cwd())

  return cachedWorkingDirectoryRealPath
}

async function realPathOfPossiblyMissing(absolute: string): Promise<string> {
  try {
    return await realpath(absolute)
  }
  catch {
    const parentReal = await realpath(dirname(absolute))
    return join(parentReal, basename(absolute))
  }
}

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep)
}

export async function resolveInsideWorkingDirectory(path: string): Promise<ResolvedPath> {
  const workingDirectory = await getWorkingDirectoryRealPath()
  const absoluteInput = resolve(process.cwd(), path)
  const absolute = await realPathOfPossiblyMissing(absoluteInput)

  if (!isInside(absolute, workingDirectory)) {
    return { ok: false, error: `path "${path}" is outside the current working directory` }
  }

  return { ok: true, absolute }
}

export async function* walkFiles(start: string): AsyncGenerator<string> {
  const workingDirectory = await getWorkingDirectoryRealPath()
  yield* walkFilesInside(start, workingDirectory)
}

async function* walkFilesInside(start: string, workingDirectory: string): AsyncGenerator<string> {
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

    if (entry.isSymbolicLink()) {
      const real = await realpath(fullPath).catch(() => null)
      if (real === null || !isInside(real, workingDirectory)) {
        continue
      }

      const realStats = await stat(real).catch(() => null)
      if (!realStats) {
        continue
      }

      if (realStats.isDirectory()) {
        yield* walkFilesInside(real, workingDirectory)
      }

      else if (realStats.isFile() && !isSensitiveFileName(entry.name)) {
        yield fullPath
      }

      continue
    }

    if (entry.isDirectory()) {
      yield* walkFilesInside(fullPath, workingDirectory)
    }
    else if (entry.isFile() && !isSensitiveFileName(entry.name)) {
      yield fullPath
    }
  }
}
