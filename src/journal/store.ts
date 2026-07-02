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
    | 'clear'

export interface JournalEvent {
  ts: string
  type: JournalEventType
  [key: string]: unknown
}

let activeRunId: string | null = null
let activeRunDir: string | null = null

export function journalEnabled(): boolean {
  return Config.USE_JOURNAL
}

export function runsDirectory(): string {
  return resolve(process.cwd(), ...RUNS_SUBDIR)
}

export function activeRunDirectory(): string | null {
  return activeRunDir
}

function makeRunId(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${day}-${time}`
}

function claimRunDirectory(baseId: string): { id: string, dir: string } | null {
  try {
    mkdirSync(runsDirectory(), { recursive: true })
  }
  catch {
    return null
  }

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}-${suffix + 1}`
    const dir = join(runsDirectory(), id)
    try {
      mkdirSync(dir)
      return { id, dir }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return null
      }
    }
  }
  return null
}

export function appendEvent(type: JournalEventType, payload: Record<string, unknown> = {}): void {
  if (!journalEnabled() || !activeRunDir) {
    return
  }
  const event: JournalEvent = { ts: new Date().toISOString(), type, ...payload }
  try {
    appendFileSync(join(activeRunDir, JOURNAL_FILE), `${JSON.stringify(event)}\n`, 'utf8')
  }
  catch {}
}

export function ensureRun(): string | null {
  if (!journalEnabled()) {
    return null
  }
  if (activeRunId) {
    return activeRunId
  }

  const claimed = claimRunDirectory(makeRunId(new Date()))
  if (!claimed) {
    return null
  }

  activeRunId = claimed.id
  activeRunDir = claimed.dir
  appendEvent('run_start', { cwd: process.cwd(), model: Config.MODEL })
  return activeRunId
}

export function adoptRun(runId: string): boolean {
  if (!journalEnabled()) {
    return false
  }
  const dir = join(runsDirectory(), runId)
  try {
    if (!statSync(dir).isDirectory()) {
      return false
    }
  }
  catch {
    return false
  }
  activeRunId = runId
  activeRunDir = dir
  appendEvent('run_start', { resumed: true })
  return true
}

export function listRuns(): string[] {
  let entries: string[]
  try {
    entries = readdirSync(runsDirectory())
  }
  catch {
    return []
  }
  return entries
    .filter((name) => {
      try {
        return statSync(join(runsDirectory(), name)).isDirectory()
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
    raw = readFileSync(join(runsDirectory(), runId, JOURNAL_FILE), 'utf8')
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
    catch {}
  }
  return events
}
