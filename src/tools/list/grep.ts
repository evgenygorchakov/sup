import type { Tool } from '../../types.ts'
import { spawn, spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import process from 'node:process'
import { Worker } from 'node:worker_threads'
import { green } from '../../utils/colors.ts'
import { isSensitiveFileName, OUTPUT_CHAR_LIMIT, resolveInsideWorkingDirectory, truncateText } from './shared.ts'

const SEARCH_TIMEOUT_MS = 30_000
const PREVIEW_MATCH_COUNT = 10
const STDOUT_COLLECT_LIMIT = OUTPUT_CHAR_LIMIT * 2

const RIPGREP_SENSITIVE_EXCLUDES = [
  '!.env',
  '!.env.*',
  '!*.{pem,key,p12,pfx,crt,cer,jks,keystore}',
  '!id_rsa*',
  '!id_dsa*',
  '!id_ecdsa*',
  '!id_ed25519*',
  '!.netrc',
  '!credentials',
  '!credentials.*',
  '!secret',
  '!secret.*',
  '!secrets',
  '!secrets.*',
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

async function searchWithRipgrep(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  caseSensitive: boolean,
): Promise<string> {
  return await new Promise<string>((resolveResult) => {
    const ripgrepArguments = ['--line-number', '--color', 'never', '--no-heading', '--hidden', '--glob', '!.git/**']
    if (!caseSensitive) {
      ripgrepArguments.push('--ignore-case')
    }
    if (glob) {
      ripgrepArguments.push('--glob', glob)
    }
    for (const exclude of RIPGREP_SENSITIVE_EXCLUDES) {
      ripgrepArguments.push('--iglob', exclude)
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
    let stdoutOverflow = false

    ripgrepProcess.stdout.on('data', (text: string) => {
      if (stdoutOverflow) {
        return
      }
      collectedStdout += text
      if (collectedStdout.length > STDOUT_COLLECT_LIMIT) {
        stdoutOverflow = true
        ripgrepProcess.kill()
      }
    })

    ripgrepProcess.stderr.on('data', (text: string) => {
      collectedStderr += text
    })

    ripgrepProcess.on('close', (exitCode) => {
      if (exitCode === 0 || stdoutOverflow) {
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

type NodeSearchMessage
  = | { ok: true, result: string }
    | { ok: false, error: string }

function runNodeSearchInWorker(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  caseSensitive: boolean,
): Promise<string> {
  return new Promise((resolveResult) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./grep-worker.ts', import.meta.url), {
        workerData: { pattern, searchPath, glob, caseSensitive },
      })
    }
    catch (error) {
      resolveResult(`ERROR: ${(error as Error).message}`)
      return
    }

    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (value: string): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolveResult(value)
    }

    timer = setTimeout(() => {
      finish(`ERROR: search timed out after ${SEARCH_TIMEOUT_MS / 1000}s (the pattern may be too expensive); narrow the pattern or path`)
    }, SEARCH_TIMEOUT_MS)

    worker.on('message', (message: NodeSearchMessage) => {
      finish(message.ok ? message.result : `ERROR: ${message.error}`)
    })
    worker.on('error', (error: Error) => finish(`ERROR: ${error.message}`))
    worker.on('exit', (code) => {
      if (code !== 0) {
        finish(`ERROR: grep worker stopped unexpectedly (exit ${code})`)
      }
    })
  })
}

export const grep: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Searches files for a regex pattern. Returns matching lines as `path:line:text`. Uses ripgrep when available (searches hidden files, respects .gitignore), otherwise a Node fallback. Skips .git, node_modules, dist, build, .next, out, coverage. Confined to the current working directory. USE WHEN: finding where a symbol, string, or pattern appears in code. DO NOT USE FOR: listing files by name (use glob), reading a file (use read_file), or running grep/rg through run_shell. EXAMPLE: {"pattern": "TODO", "glob": "*.ts"} or case-insensitive {"pattern": "fixme", "caseSensitive": false}.',
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

    const targetStats = await stat(resolved.absolute).catch(() => null)
    if (targetStats?.isFile() && isSensitiveFileName(basename(resolved.absolute))) {
      return `ERROR: refused to search sensitive file "${pathInput}"`
    }

    const result = ripgrepAvailable
      ? await searchWithRipgrep(pattern, resolved.absolute, glob, caseSensitive)
      : await runNodeSearchInWorker(pattern, resolved.absolute, glob, caseSensitive)

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
