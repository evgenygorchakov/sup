import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

type ResolvedPath = | { ok: true, absolute: string } | { ok: false, error: string }

export const OUTPUT_CHAR_LIMIT = 20_000

export const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
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
    const parent = dirname(absolute)
    if (parent === absolute) {
      return absolute
    }
    const parentReal = await realPathOfPossiblyMissing(parent)
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

const PROTECTED_DIRECTORY_NAMES = new Set(['.git', '.sup'])

export async function isProtectedProjectPath(absolute: string): Promise<boolean> {
  const workingDirectory = await getWorkingDirectoryRealPath()
  if (!isInside(absolute, workingDirectory)) {
    return false
  }
  return relative(workingDirectory, absolute)
    .split(sep)
    .some(segment => PROTECTED_DIRECTORY_NAMES.has(segment))
}

export async function* walkFiles(start: string): AsyncGenerator<string> {
  const workingDirectory = await getWorkingDirectoryRealPath()
  yield* walkFilesInside(start, workingDirectory, new Set())
}

async function* walkFilesInside(start: string, workingDirectory: string, visited: Set<string>): AsyncGenerator<string> {
  const stats = await stat(start).catch(() => null)
  if (!stats) {
    return
  }

  if (stats.isFile()) {
    if (!isSensitiveFileName(basename(start))) {
      yield start
    }
    return
  }

  if (!stats.isDirectory()) {
    return
  }

  if (visited.has(start)) {
    return
  }
  visited.add(start)

  const entries = await readdir(start, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
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
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          yield* walkFilesInside(real, workingDirectory, visited)
        }
      }

      else if (realStats.isFile() && !isSensitiveFileName(entry.name) && !isSensitiveFileName(basename(real))) {
        yield fullPath
      }

      continue
    }

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        yield* walkFilesInside(fullPath, workingDirectory, visited)
      }
    }
    else if (entry.isFile() && !isSensitiveFileName(entry.name)) {
      yield fullPath
    }
  }
}
