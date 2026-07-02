import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { JournalEvent } from '../journal/index.ts'
import type { Message, ToolCall } from '../types.ts'
import type { LedgerStep, StepStatus } from './session.ts'
import type { GateDecision } from './verification.ts'
import { Config } from '../config.ts'
import { adoptRun, appendEvent, listRuns, loadRunEvents, reconstructMessages } from '../journal/index.ts'
import { buildPlanReminder } from '../plan/active-plan.ts'
import { ledgerToolRegistered } from './ledger-tool.ts'
import { buildLedgerReminder } from './ledger.ts'
import { activateTask, clearTask, getLedger, getVerificationSource, noteShellRun, resetGate } from './session.ts'
import { runCompletionGate as gateImpl } from './verification.ts'

export { markStep } from './ledger.ts'
export { activatePlan, activateSkill } from './task-source.ts'

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

let lastLedgerRecord: string | null = null

export function recordLedgerState(): void {
  if (!Config.USE_BABYSITTER || !Config.BABYSITTER_LEDGER) {
    return
  }
  const ledger = getLedger()
  if (!ledger) {
    return
  }
  const record = JSON.stringify(ledger)
  if (record === lastLedgerRecord) {
    return
  }
  lastLedgerRecord = record
  appendEvent('ledger', { source: 'progress', ledger, verificationSource: getVerificationSource() })
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

const STEP_STATUSES = new Set<string>(['pending', 'in_progress', 'done'])

function asLedgerSteps(value: unknown): LedgerStep[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const steps: LedgerStep[] = []
  for (const entry of value) {
    const step = entry as Partial<LedgerStep> | null
    if (!step || typeof step.id !== 'number' || !Number.isInteger(step.id)
      || typeof step.text !== 'string' || typeof step.status !== 'string' || !STEP_STATUSES.has(step.status)) {
      return null
    }
    steps.push({ id: step.id, text: step.text, status: step.status as StepStatus })
  }
  return steps
}

function lastTaskSnapshot(events: JournalEvent[]): TaskSnapshot | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'finish' || event.type === 'clear') {
      return null
    }
    if (event.type === 'ledger') {
      return {
        ledger: asLedgerSteps(event.ledger),
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
  repairTrailingToolCalls(restored)

  for (const message of restored) {
    messages.push(message)
  }

  const snapshot = lastTaskSnapshot(events)
  if (snapshot) {
    activateTask(ledgerToolRegistered ? snapshot.ledger : null, snapshot.verificationSource)
  }

  return { ok: true, runId: target, restored: restored.length }
}

const INTERRUPTED_TOOL_RESULT = 'Not executed: the session ended before this tool call finished.'

function repairTrailingToolCalls(messages: Message[]): void {
  const answeredIds = new Set<string>()
  let anonymousResults = 0
  let index = messages.length - 1
  while (index >= 0 && messages[index]!.role === 'tool') {
    const id = messages[index]!.tool_call_id
    if (id) {
      answeredIds.add(id)
    }
    else {
      anonymousResults += 1
    }
    index -= 1
  }
  if (index < 0) {
    return
  }
  const last = messages[index]!
  if (last.role !== 'assistant' || !last.tool_calls || last.tool_calls.length === 0) {
    return
  }
  for (const call of last.tool_calls) {
    if (call.id) {
      if (answeredIds.has(call.id)) {
        continue
      }
    }
    else if (anonymousResults > 0) {
      anonymousResults -= 1
      continue
    }
    messages.push({ role: 'tool', content: INTERRUPTED_TOOL_RESULT, tool_call_id: call.id })
  }
}
