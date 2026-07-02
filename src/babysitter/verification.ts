import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { Message } from '../types.ts'
import process from 'node:process'
import { Config } from '../config.ts'
import { appendEvent, recordUserMessage } from '../journal/index.ts'
import { isAutoModeActive } from '../plan/mode-state.ts'
import { executeShellCommand } from '../tools/list/run-shell.ts'
import { isShellCommandAutoApprovable } from '../tools/shell-auto-approve.ts'
import { isSkipPermissionsActive } from '../tools/skip-permissions.ts'
import { brightGreen, gray, red, yellow } from '../utils/colors.ts'
import { extractCommands } from './parse-sections.ts'
import {
  areGateChecksApproved,
  getGateAttempts,
  getVerificationSource,
  hasShellRunSinceGate,
  isGatePassed,
  markGateChecksApproved,
  markGatePassed,
  recordGateAttempt,
  requireFreshShellRun,
} from './session.ts'

export type GateDecision = 'finish' | 'continue'

const EXIT_CODE_LINE = /^exit=(-?\d+)/
const MAX_FAILURE_OUTPUT_CHARS = 1500
const MAX_REPORTED_FAILURES = 3

function gateEnabled(): boolean {
  return Config.USE_BABYSITTER && Config.BABYSITTER_VERIFICATION_GATE
}

function shellAvailable(): boolean {
  return Config.USE_SHELL_TOOL && !Config.USE_READ_ONLY_MODE
}

function parseExitCode(shellResult: string): number | null {
  const match = EXIT_CODE_LINE.exec(shellResult)
  return match ? Number(match[1]) : null
}

function tailOfOutput(result: string): string {
  if (result.length <= MAX_FAILURE_OUTPUT_CHARS) {
    return result
  }
  return `...[truncated]\n${result.slice(-MAX_FAILURE_OUTPUT_CHARS)}`
}

async function runChecks(commands: string[]): Promise<string[]> {
  const failures: string[] = []
  for (const command of commands) {
    console.warn(yellow(`  [gate] $ ${command}`))
    const result = await executeShellCommand(command, Config.BABYSITTER_GATE_TIMEOUT_MS)
    const exitCode = parseExitCode(result)
    appendEvent('gate', { command, exit: exitCode })
    if (exitCode !== 0) {
      failures.push(`$ ${command}\n${tailOfOutput(result)}`)
    }
  }
  return failures
}

function pushUserMessage(messages: Message[], content: string): void {
  const message: Message = { role: 'user', content }
  messages.push(message)
  recordUserMessage(message)
}

function checksNeedApproval(commands: string[]): boolean {
  if (areGateChecksApproved() || isSkipPermissionsActive() || isAutoModeActive()) {
    return false
  }
  return commands.some(command => !isShellCommandAutoApprovable(command))
}

type ChecksApproval = 'approved' | 'declined' | { feedback: string }

async function askChecksApproval(commands: string[], readline: ReadlineInterface): Promise<ChecksApproval> {
  console.warn(yellow('\n[gate] About to run the verification checks:'))
  for (const command of commands) {
    console.warn(`  $ ${command}`)
  }
  while (true) {
    const answer = (await readline.question(brightGreen('\n[y / n / type feedback] '))).trim()
    const lowered = answer.toLowerCase()
    if (lowered === 'y') {
      return 'approved'
    }
    if (lowered === 'n') {
      return 'declined'
    }
    if (answer) {
      return { feedback: answer }
    }
  }
}

function requireManualVerification(messages: Message[], verificationSource: string): GateDecision {
  if (getGateAttempts() > 0 && hasShellRunSinceGate()) {
    markGatePassed()
    appendEvent('gate', { result: 'manual_done' })
    return 'finish'
  }

  recordGateAttempt()
  requireFreshShellRun()
  appendEvent('gate', { result: 'manual_required', attempts: getGateAttempts() })
  pushUserMessage(messages, [
    'Reminder from the harness, not from the user. Do not finish yet — you must verify the result first.',
    'Run the checks below with run_shell, look at the output, fix anything that fails, then finish.',
    '',
    verificationSource,
  ].join('\n'))
  return 'continue'
}

function reportFailedChecks(messages: Message[], failures: string[]): void {
  const reported = failures.slice(0, MAX_REPORTED_FAILURES)
  const omitted = failures.length - reported.length
  if (omitted > 0) {
    reported.push(`...and ${omitted} more check(s) failed.`)
  }
  pushUserMessage(messages, [
    'Reminder from the harness, not from the user. The verification checks failed, so the task is not done.',
    'Fix the problems shown below, then continue. The checks will run again when you next try to finish.',
    '',
    ...reported,
  ].join('\n\n'))
}

export async function runCompletionGate(messages: Message[], readline: ReadlineInterface): Promise<GateDecision> {
  if (!gateEnabled()) {
    return 'finish'
  }

  const verificationSource = getVerificationSource()
  if (isGatePassed() || !verificationSource) {
    return 'finish'
  }
  if (!shellAvailable()) {
    appendEvent('gate', { result: 'no_shell' })
    return 'finish'
  }
  if (getGateAttempts() >= Config.BABYSITTER_GATE_MAX_ATTEMPTS) {
    console.warn(yellow(`[gate] gave up after ${getGateAttempts()} attempt(s); allowing finish.`))
    appendEvent('gate', { result: 'gave_up', attempts: getGateAttempts() })
    return 'finish'
  }

  const commands = extractCommands(verificationSource)
  if (commands.length === 0) {
    return requireManualVerification(messages, verificationSource)
  }

  if (checksNeedApproval(commands)) {
    if (!process.stdin.isTTY) {
      appendEvent('gate', { result: 'no_tty' })
      return 'finish'
    }
    const approval = await askChecksApproval(commands, readline)
    if (approval === 'declined') {
      appendEvent('gate', { result: 'declined' })
      return 'finish'
    }
    if (approval !== 'approved') {
      appendEvent('gate', { result: 'feedback' })
      pushUserMessage(messages, approval.feedback)
      return 'continue'
    }
    markGateChecksApproved()
  }

  console.warn(gray(`[gate] running ${commands.length} verification check(s)...`))
  const failures = await runChecks(commands)

  if (failures.length === 0) {
    markGatePassed()
    appendEvent('gate', { result: 'pass', checks: commands.length })
    console.warn(gray('[gate] verification passed.'))
    return 'finish'
  }

  recordGateAttempt()
  appendEvent('gate', { result: 'fail', attempts: getGateAttempts(), failed: failures.length })
  console.warn(red(`[gate] verification failed (${failures.length}/${commands.length}); continuing.`))
  reportFailedChecks(messages, failures)
  return 'continue'
}
