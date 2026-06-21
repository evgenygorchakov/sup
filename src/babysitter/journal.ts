// Event-sourced journal: an append-only .sup/runs/<runId>/journal.jsonl that
// records every step of a run so it can be audited and resumed. Mirrors
// Babysitter's .a5c/runs/ ledger. All writes are best-effort and never throw.

import type { Message } from '../types.ts'
import type { LedgerStep } from './session.ts'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Config } from '../config.ts'

const RUNS_SUBDIR = ['.sup', 'runs']
const JOURNAL_FILE = 'journal.jsonl'

export type JournalEventType
  = | 'run_start'
    | 'user'
    | 'assistant'
    | 'tool_call'
    | 'tool_result'
    | 'gate'
    | 'ledger'
    | 'finish'

export interface JournalEvent {
  ts: string
  type: JournalEventType
  [key: string]: unknown
}

let currentRunDir: string | null = null
let currentRunId: string | null = null

function journalEnabled(): boolean {
  return Config.USE_BABYSITTER && Config.BABYSITTER_JOURNAL
}

function makeRunId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}`
}

function runsRoot(): string {
  return resolve(process.cwd(), ...RUNS_SUBDIR)
}

export function appendEvent(type: JournalEventType, payload: Record<string, unknown> = {}): void {
  if (!journalEnabled() || !currentRunDir) {
    return
  }
  const event: JournalEvent = { ts: new Date().toISOString(), type, ...payload }
  try {
    appendFileSync(join(currentRunDir, JOURNAL_FILE), `${JSON.stringify(event)}\n`, 'utf8')
  }
  catch {
    // Journal is best-effort; never break the agent loop over a write failure.
  }
}

// Lazily create the run directory on first use and reuse it for the rest of the
// process. Returns the run id, or null when journaling is disabled / unwritable.
export function ensureRun(): string | null {
  if (!journalEnabled()) {
    return null
  }
  if (currentRunId) {
    return currentRunId
  }

  const id = makeRunId(new Date())
  const dir = join(runsRoot(), id)
  try {
    mkdirSync(dir, { recursive: true })
  }
  catch {
    return null
  }

  currentRunId = id
  currentRunDir = dir
  appendEvent('run_start', { cwd: process.cwd(), model: Config.MODEL })
  return id
}

// Adopt an existing run so new events append to its journal (used on --resume).
export function adoptRun(runId: string): boolean {
  if (!journalEnabled()) {
    return false
  }
  const dir = join(runsRoot(), runId)
  try {
    if (!statSync(dir).isDirectory()) {
      return false
    }
  }
  catch {
    return false
  }
  currentRunId = runId
  currentRunDir = dir
  appendEvent('run_start', { resumed: true })
  return true
}

export function listRuns(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(runsRoot())
  }
  catch {
    return []
  }
  return entries
    .filter((name) => {
      try {
        return statSync(join(runsRoot(), name)).isDirectory()
      }
      catch {
        return false
      }
    })
    .sort()
}

export function loadRunEvents(runId: string): JournalEvent[] {
  let raw: string
  try {
    raw = readFileSync(join(runsRoot(), runId, JOURNAL_FILE), 'utf8')
  }
  catch {
    return []
  }

  const events: JournalEvent[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      events.push(JSON.parse(trimmed) as JournalEvent)
    }
    catch {
      // Skip a corrupt line rather than abandoning the whole journal.
    }
  }
  return events
}

// Rebuild the conversation from journalled user/assistant/tool messages.
export function reconstructMessages(events: JournalEvent[]): Message[] {
  const messages: Message[] = []
  for (const event of events) {
    if ((event.type === 'user' || event.type === 'assistant' || event.type === 'tool_result') && event.message) {
      messages.push(event.message as Message)
    }
  }
  return messages
}

export interface TaskSnapshot {
  ledger: LedgerStep[] | null
  verificationSource: string | null
}

// The most recent ledger snapshot, so a resumed run keeps its step state.
export function lastTaskSnapshot(events: JournalEvent[]): TaskSnapshot | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'ledger') {
      return {
        ledger: Array.isArray(event.ledger) ? (event.ledger as LedgerStep[]) : null,
        verificationSource: typeof event.verificationSource === 'string' ? event.verificationSource : null,
      }
    }
  }
  return null
}
