import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { Message, ToolCall } from '../types.ts'
import type { GateDecision } from './verification.ts'
import { Config } from '../config.ts'
import { buildPlanReminder } from '../plan/active-plan.ts'
import {
  adoptRun,
  appendEvent,
  ensureRun,
  lastTaskSnapshot,
  listRuns,
  loadRunEvents,
  persistImages,
  reconstructMessages,
} from './journal.ts'
import { ledgerToolRegistered } from './ledger-tool.ts'
import { buildLedgerReminder } from './ledger.ts'
import { activateTask, clearTask, getLedger, getVerificationSource, noteShellRun, resetGate } from './session.ts'
import { runCompletionGate as gateImpl } from './verification.ts'

export { markStep } from './ledger.ts'
export { activatePlan, activateSkill, isGatedSkill } from './task-source.ts'

export function startTurn(messages: Message[]): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  ensureRun()
  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    const imageRefs = last.images?.length ? persistImages(last.images) : null
    appendEvent('user', { message: { ...last, images: undefined }, images: imageRefs ?? undefined })
  }
  resetGate()
}

export function recordAssistant(reply: Message): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  appendEvent('assistant', { message: reply })
}

export function recordToolCall(call: ToolCall): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  appendEvent('tool_call', { name: call.function.name, arguments: call.function.arguments, id: call.id })
  if (call.function.name === 'run_shell') {
    noteShellRun()
  }
}

export function recordToolResult(call: ToolCall, result: string): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  appendEvent('tool_result', {
    name: call.function.name,
    message: { role: 'tool', content: result, tool_call_id: call.id },
  })
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
  appendEvent('finish', {})
  clearTask()
}

export function clearConversation(): void {
  clearTask()
  appendEvent('clear')
}

export interface ResumeOutcome {
  ok: boolean
  runId?: string
  restored?: number
  reason?: 'disabled' | 'not_found'
}

export function resumeIntoMessages(runId: string | undefined, messages: Message[]): ResumeOutcome {
  if (!Config.USE_BABYSITTER || !Config.BABYSITTER_JOURNAL) {
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
