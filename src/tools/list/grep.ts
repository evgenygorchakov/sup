import type { Tool } from '../../types.ts'
import { spawn, spawnSync } from 'node:child_process'
import { readFile as readFromDisk, stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import process from 'node:process'
import { green } from '../../utils/colors.ts'
import { resolveInsideWorkingDirectory, truncateText, walkFiles } from './shared.ts'

const SEARCH_TIMEOUT_MS = 30_000
const MAX_FILE_BYTES = 5 * 1024 * 1024
const PREVIEW_MATCH_COUNT = 10

const RIPGREP_SENSITIVE_EXCLUDES = [
  '!.env',
  '!.env.*',
  '!*.{pem,key,p12,pfx,crt,cer,jks,keystore}',
  '!id_rsa*',
  '!id_dsa*',
  '!id_ecdsa*',
  '!id_ed25519*',
  '!.netrc',
  '!credentials*',
  '!secret*',
  '!secrets*',
  '!.htpasswd',
  '!.ssh/**',
  '!.aws/**',
  '!.gnupg/**',
]

const ripgrepAvailable = (() => {
  try {
    const probe = spawnSync('rg', ['--version'], { stdio: 'ignore' })
    return probe.status === 0
  }
  catch {
    return false
  }
})()

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  return new RegExp(`^${escaped}$`)
}

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  caseSensitive: boolean,
): Promise<string> {
  return await new Promise<string>((resolveResult) => {
    const ripgrepArguments = ['--line-number', '--color', 'never', '--no-heading']
    if (!caseSensitive) {
      ripgrepArguments.push('--ignore-case')
    }
    if (glob) {
      ripgrepArguments.push('--glob', glob)
    }
    for (const exclude of RIPGREP_SENSITIVE_EXCLUDES) {
      ripgrepArguments.push('--glob', exclude)
    }
    ripgrepArguments.push('--regexp', pattern, searchPath)

    const ripgrepProcess = spawn('rg', ripgrepArguments, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })

    ripgrepProcess.stdout.setEncoding('utf8')
    ripgrepProcess.stderr.setEncoding('utf8')
    ripgrepProcess.stdin.end()

    let collectedStdout = ''
    let collectedStderr = ''

    ripgrepProcess.stdout.on('data', (text: string) => {
      collectedStdout += text
    })

    ripgrepProcess.stderr.on('data', (text: string) => {
      collectedStderr += text
    })

    ripgrepProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolveResult(collectedStdout)
        return
      }
      if (exitCode === 1) {
        resolveResult(`No matches for "${pattern}" in ${relative(process.cwd(), searchPath) || '.'}`)
        return
      }
      resolveResult(`ERROR: ripgrep failed (exit=${exitCode})\n${collectedStderr.trim()}`)
    })

    ripgrepProcess.on('error', (error) => {
      resolveResult(`ERROR: ${error.message}`)
    })
  })
}

async function searchWithNode(
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

export const grep: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Searches files for a regex pattern. Returns matching lines as `path:line:text`. Uses ripgrep when available, otherwise a Node fallback. Skips .git, node_modules, dist, build, .next, out, coverage. Confined to the current working directory. USE WHEN: finding where a symbol, string, or pattern appears in code. DO NOT USE FOR: listing files by name (use glob), reading a file (use read_file), or running grep/rg through run_shell. EXAMPLE: {"pattern": "TODO", "glob": "*.ts"} or case-insensitive {"pattern": "fixme", "caseSensitive": false}.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for (NOT a glob; "." matches any char, use "\\." for a literal dot).',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in. Defaults to the current working directory.',
          },
          glob: {
            type: 'string',
            description: 'Filename glob filter matched against the basename only (e.g. "*.ts", "*.test.*"). Does NOT filter by directory path.',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Case-sensitive matching. Defaults to true.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as {
      pattern?: unknown
      path?: unknown
      glob?: unknown
      caseSensitive?: unknown
    }
    const pattern = args.pattern
    const pathInput = typeof args.path === 'string' ? args.path : '.'
    const glob = typeof args.glob === 'string' ? args.glob : undefined
    const caseSensitive = args.caseSensitive !== false

    if (typeof pattern !== 'string' || pattern.length === 0) {
      return 'ERROR: grep expects { pattern: string, path?: string, glob?: string, caseSensitive?: boolean }'
    }

    const resolved = await resolveInsideWorkingDirectory(pathInput)
    if (!resolved.ok) {
      return `ERROR: ${resolved.error}`
    }

    const result = ripgrepAvailable
      ? await searchWithRipgrep(pattern, resolved.absolute, glob, caseSensitive)
      : await searchWithNode(pattern, resolved.absolute, glob, caseSensitive)

    return truncateText(result)
  },
  primaryArgs: ['pattern', 'path', 'glob', 'caseSensitive'],
  accentColor: green,
  renderResult: (_args, result) => {
    if (result.startsWith('No matches')) {
      const firstLineEnd = result.indexOf('\n')
      return firstLineEnd === -1 ? result : result.slice(0, firstLineEnd)
    }

    const lines = result.split('\n').filter(line => line.length > 0 && !line.startsWith('...['))
    const fileSet = new Set<string>()

    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        fileSet.add(line.slice(0, colonIndex))
      }
    }

    const header = `Found ${lines.length} matches in ${fileSet.size} files`
    const preview = lines.slice(0, PREVIEW_MATCH_COUNT).join('\n')
    const remainder = lines.length > PREVIEW_MATCH_COUNT
      ? `\n… +${lines.length - PREVIEW_MATCH_COUNT} more matches`
      : ''

    return `${header}\n${preview}${remainder}`
  },
  autoApprove: true,
}
