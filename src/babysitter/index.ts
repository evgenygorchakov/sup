import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { JournalEvent } from '../journal/index.ts'
import type { Message, ToolCall } from '../types.ts'
import type { LedgerStep } from './session.ts'
import type { GateDecision } from './verification.ts'
import { Config } from '../config.ts'
import { adoptRun, appendEvent, listRuns, loadRunEvents, reconstructMessages } from '../journal/index.ts'
import { buildPlanReminder } from '../plan/active-plan.ts'
import { ledgerToolRegistered } from './ledger-tool.ts'
import { buildLedgerReminder } from './ledger.ts'
import { activateTask, clearTask, getLedger, getVerificationSource, noteShellRun, resetGate } from './session.ts'
import { runCompletionGate as gateImpl } from './verification.ts'

export { markStep } from './ledger.ts'
export { activatePlan, activateSkill, isGatedSkill } from './task-source.ts'

export function beginTurn(): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  resetGate()
}

export function noteToolCall(call: ToolCall): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  if (call.function.name === 'run_shell') {
    noteShellRun()
  }
}

export function recordLedgerState(): void {
  if (!Config.USE_BABYSITTER || !Config.BABYSITTER_LEDGER) {
    return
  }
  const ledger = getLedger()
  if (ledger) {
    appendEvent('ledger', { source: 'progress', ledger, verificationSource: getVerificationSource() })
  }
}

export function buildHarnessReminder(): Message | null {
  if (Config.USE_BABYSITTER && Config.BABYSITTER_LEDGER) {
    const ledgerReminder = buildLedgerReminder()
    if (ledgerReminder) {
      return ledgerReminder
    }
  }
  return buildPlanReminder()
}

export async function runCompletionGate(messages: Message[], readline: ReadlineInterface): Promise<GateDecision> {
  return gateImpl(messages, readline)
}

export function finishTask(): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  clearTask()
}

export function clearConversation(): void {
  clearTask()
}

interface TaskSnapshot {
  ledger: LedgerStep[] | null
  verificationSource: string | null
}

function lastTaskSnapshot(events: JournalEvent[]): TaskSnapshot | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'finish' || event.type === 'clear') {
      return null
    }
    if (event.type === 'ledger') {
      return {
        ledger: Array.isArray(event.ledger) ? (event.ledger as LedgerStep[]) : null,
        verificationSource: typeof event.verificationSource === 'string' ? event.verificationSource : null,
      }
    }
  }
  return null
}

export interface ResumeOutcome {
  ok: boolean
  runId?: string
  restored?: number
  reason?: 'disabled' | 'not_found'
}

export function resumeIntoMessages(runId: string | undefined, messages: Message[]): ResumeOutcome {
  if (!Config.USE_JOURNAL) {
    return { ok: false, reason: 'disabled' }
  }
  const target = runId ?? listRuns().at(-1)
  if (!target || !adoptRun(target)) {
    return { ok: false, reason: 'not_found' }
  }

  const events = loadRunEvents(target)
  const restored = reconstructMessages(events, target)
  dropTrailingUnansweredToolCalls(restored)

  for (const message of restored) {
    messages.push(message)
  }

  const snapshot = lastTaskSnapshot(events)
  if (snapshot) {
    activateTask(ledgerToolRegistered ? snapshot.ledger : null, snapshot.verificationSource)
  }

  return { ok: true, runId: target, restored: restored.length }
}

function dropTrailingUnansweredToolCalls(messages: Message[]): void {
  while (messages.length > 0) {
    const last = messages[messages.length - 1]!
    if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
      messages.pop()
    }
    else {
      break
    }
  }
}
