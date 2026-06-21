// Public surface of the babysitter module. The agent and entrypoint import only
// from here. Every hook is a no-op when USE_BABYSITTER is off, so callers can
// invoke them unconditionally (same idiom as collapseOldToolResults).

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
  reconstructMessages,
} from './journal.ts'
import { buildLedgerReminder } from './ledger.ts'
import { activateTask, clearTask, getLedger, getVerificationSource, noteShellRun, resetGate } from './session.ts'
import { runCompletionGate as gateImpl } from './verification.ts'

export { markStep } from './ledger.ts'
export { activatePlan, activateSkill, isGatedSkill } from './task-source.ts'

// Start of a user turn: open the run, journal the user message, and invalidate
// any previously passed gate so new instructions get re-verified.
export function startTurn(messages: Message[]): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  ensureRun()
  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    // Drop image bytes before journaling: base64 would bloat the JSONL and isn't
    // needed to resume a run. (undefined keys are omitted by JSON.stringify.)
    appendEvent('user', { message: last.images ? { ...last, images: undefined } : last })
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

// Snapshot the ledger after a turn's tool calls so resume keeps step state.
export function recordLedgerState(): void {
  if (!Config.USE_BABYSITTER || !Config.BABYSITTER_LEDGER) {
    return
  }
  const ledger = getLedger()
  if (ledger) {
    appendEvent('ledger', { source: 'progress', ledger, verificationSource: getVerificationSource() })
  }
}

// Reminder injected before each model call: the ledger if one is active,
// otherwise the plain plan reminder (so plan mode keeps working).
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

export interface ResumeOutcome {
  ok: boolean
  runId?: string
  restored?: number
}

// Restore a previous run into `messages` and re-activate its ledger/gate.
// `runId` undefined means "the latest run".
export function resumeIntoMessages(runId: string | undefined, messages: Message[]): ResumeOutcome {
  if (!Config.USE_BABYSITTER || !Config.BABYSITTER_JOURNAL) {
    return { ok: false }
  }
  const target = runId ?? listRuns().at(-1)
  if (!target || !adoptRun(target)) {
    return { ok: false }
  }

  const events = loadRunEvents(target)
  const restored = reconstructMessages(events)

  // Drop a trailing assistant-with-tool-calls left by an interrupted turn: its
  // tool results were never recorded, so continuing from it would be malformed.
  while (restored.length > 0) {
    const last = restored[restored.length - 1]!
    if (last.role === 'assistant' && last.tool_calls && last.tool_calls.length > 0) {
      restored.pop()
    }
    else {
      break
    }
  }

  for (const message of restored) {
    messages.push(message)
  }

  const snapshot = lastTaskSnapshot(events)
  if (snapshot) {
    activateTask(snapshot.ledger, snapshot.verificationSource)
  }

  return { ok: true, runId: target, restored: restored.length }
}
