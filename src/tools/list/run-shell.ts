import type { ChildProcess } from 'node:child_process'
import type { Tool } from '../../types.ts'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { yellow } from '../../utils/colors.ts'

const COMMAND_TIMEOUT_MS = 30_000
const SIGKILL_GRACE_MS = 2_000
const STREAM_CHAR_LIMIT = 20_000
const STDOUT_MARKER = '\n--stdout--\n'
const STDERR_MARKER = '\n--stderr--\n'

type Status
  = | { kind: 'exit', code: number }
    | { kind: 'signal', signal: NodeJS.Signals, timedOut: boolean }
    | { kind: 'error', message: string }

interface Accumulator {
  push: (chunk: string) => void
  finalize: () => string
}

function createAccumulator(limit: number): Accumulator {
  let text = ''
  let truncated = false
  return {
    push(chunk) {
      if (truncated) {
        return
      }
      const remaining = limit - text.length
      if (chunk.length <= remaining) {
        text += chunk
        return
      }
      text += chunk.slice(0, remaining)
      truncated = true
    },
    finalize() {
      return truncated ? `${text}\n...[truncated]` : text
    },
  }
}

function describeStatus(status: Status): string {
  if (status.kind === 'exit') {
    return `exit=${status.code}`
  }
  if (status.kind === 'signal') {
    return `signal=${status.signal}${status.timedOut ? ' (timeout)' : ''}`
  }
  return `exec_error: ${status.message}`
}

function formatResult(status: Status, stdout: string, stderr: string): string {
  return `${describeStatus(status)}${STDOUT_MARKER}${stdout}${STDERR_MARKER}${stderr}`
}

type ParsedResult
  = | { ok: true, head: string, stdout: string, stderr: string }
    | { ok: false }

function parseResult(text: string): ParsedResult {
  const stdoutAt = text.indexOf(STDOUT_MARKER)
  if (stdoutAt === -1) {
    return { ok: false }
  }
  const stderrAt = text.lastIndexOf(STDERR_MARKER)
  if (stderrAt === -1 || stderrAt <= stdoutAt) {
    return { ok: false }
  }
  return {
    ok: true,
    head: text.slice(0, stdoutAt),
    stdout: text.slice(stdoutAt + STDOUT_MARKER.length, stderrAt),
    stderr: text.slice(stderrAt + STDERR_MARKER.length),
  }
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    return
  }
  try {
    process.kill(-child.pid, signal)
  }
  catch {
  }
}

export function executeShellCommand(command: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdout = createAccumulator(STREAM_CHAR_LIMIT)
    const stderr = createAccumulator(STREAM_CHAR_LIMIT)

    let child: ChildProcess
    try {
      child = spawn('bash', ['-c', command], {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', CI: '1' },
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }
    catch (error) {
      resolve(formatResult({ kind: 'error', message: (error as Error).message }, '', ''))
      return
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdin?.end()

    child.stdout?.on('data', (text: string) => stdout.push(text))
    child.stderr?.on('data', (text: string) => stderr.push(text))

    let timedOut = false
    let killTimer: NodeJS.Timeout | null = null

    const timeoutHandle = setTimeout(() => {
      timedOut = true
      killGroup(child, 'SIGTERM')
      killTimer = setTimeout(killGroup, SIGKILL_GRACE_MS, child, 'SIGKILL')
    }, timeoutMs)

    let settled = false
    const settle = (status: Status): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeoutHandle)
      if (killTimer !== null) {
        clearTimeout(killTimer)
      }
      resolve(formatResult(status, stdout.finalize(), stderr.finalize()))
    }

    child.on('close', (code, signal) => {
      if (signal !== null) {
        settle({ kind: 'signal', signal, timedOut })
        return
      }
      settle({ kind: 'exit', code: code ?? -1 })
    })

    child.on('error', (error) => {
      settle({ kind: 'error', message: error.message })
    })
  })
}

export const runShell: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Executes a bash command in the user\'s shell (unsandboxed, user\'s permissions). Returns exit/signal status plus stdout and stderr. Hard limits: 30s timeout (SIGTERM, then SIGKILL after 2s) and ~20k chars per stream (tail truncated). Stdin is closed; non-interactive only. USE WHEN: running git, package managers (npm/pnpm/yarn/bun), build, lint, tests, or starting/inspecting processes. DO NOT USE FOR: reading files (use read_file), creating files (use write_file), editing files (use edit_file), searching file contents (use grep), listing files (use glob), or fetching URLs (use fetch_url). For cat/head/tail/grep/rg/find/ls/echo/curl/wget prefer the dedicated tool. EXAMPLES: {"command": "git status"}, {"command": "npm test"}, {"command": "tsc --noEmit"}.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute (passed to `bash -c`).',
          },
        },
        required: ['command'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const command = (rawArguments as { command?: unknown })?.command

    if (typeof command !== 'string' || command.length === 0 || command.includes('\0')) {
      return 'ERROR: run_shell expects { command: string } (non-empty, no NUL bytes)'
    }

    return executeShellCommand(command, COMMAND_TIMEOUT_MS)
  },
  primaryArgs: ['command'],
  accentColor: yellow,
  mutates: true,
  renderResult: (_args, result) => {
    const parsed = parseResult(result)
    if (!parsed.ok) {
      return result
    }

    const trimmedStdout = parsed.stdout.trim()
    const trimmedStderr = parsed.stderr.trim()

    if (parsed.head === 'exit=0') {
      return trimmedStdout || '(no output)'
    }

    const parts: string[] = [parsed.head]
    if (trimmedStdout) {
      parts.push(trimmedStdout)
    }
    if (trimmedStderr) {
      parts.push(`stderr: ${trimmedStderr}`)
    }
    return parts.join('\n')
  },
}
