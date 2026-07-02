import type { ImageAttachment, Message } from '../types.ts'
import type { LedgerStep } from './session.ts'
import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Config } from '../config.ts'

const RUNS_SUBDIR = ['.sup', 'runs']
const JOURNAL_FILE = 'journal.jsonl'
const IMAGES_SUBDIR = 'images'

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
  catch {}
}

function claimRunDir(baseId: string): { id: string, dir: string } | null {
  try {
    mkdirSync(runsRoot(), { recursive: true })
  }
  catch {
    return null
  }

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const id = suffix === 0 ? baseId : `${baseId}-${suffix + 1}`
    const dir = join(runsRoot(), id)
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

export function ensureRun(): string | null {
  if (!journalEnabled()) {
    return null
  }
  if (currentRunId) {
    return currentRunId
  }

  const claimed = claimRunDir(makeRunId(new Date()))
  if (!claimed) {
    return null
  }

  currentRunId = claimed.id
  currentRunDir = claimed.dir
  appendEvent('run_start', { cwd: process.cwd(), model: Config.MODEL })
  return currentRunId
}

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
    catch {}
  }
  return events
}

export interface ImageRef {
  file: string
  mimeType: string
}

let imageSequence = 0

function mimeToExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    default: return 'png'
  }
}

export function persistImages(images: ImageAttachment[]): ImageRef[] | null {
  if (!journalEnabled() || !currentRunDir || images.length === 0) {
    return null
  }

  const dir = join(currentRunDir, IMAGES_SUBDIR)
  try {
    mkdirSync(dir, { recursive: true })
  }
  catch {
    return null
  }

  const refs: ImageRef[] = []
  for (const image of images) {
    const file = `${Date.now()}-${imageSequence++}.${mimeToExtension(image.mimeType)}`
    try {
      writeFileSync(join(dir, file), Buffer.from(image.base64, 'base64'))
      refs.push({ file, mimeType: image.mimeType })
    }
    catch {}
  }
  return refs.length > 0 ? refs : null
}

function loadImages(runId: string, refs: ImageRef[]): ImageAttachment[] {
  const dir = join(runsRoot(), runId, IMAGES_SUBDIR)
  const images: ImageAttachment[] = []
  for (const ref of refs) {
    try {
      const bytes = readFileSync(join(dir, ref.file))
      images.push({ base64: bytes.toString('base64'), mimeType: ref.mimeType })
    }
    catch {}
  }
  return images
}

export function reconstructMessages(events: JournalEvent[], runId: string): Message[] {
  const messages: Message[] = []
  for (const event of events) {
    if (event.type === 'clear') {
      messages.length = 0
      continue
    }
    if ((event.type === 'user' || event.type === 'assistant' || event.type === 'tool_result') && event.message) {
      const message = event.message as Message
      if (event.type === 'user' && Array.isArray(event.images) && event.images.length > 0) {
        const images = loadImages(runId, event.images as ImageRef[])
        if (images.length > 0) {
          message.images = images
        }
      }
      messages.push(message)
    }
  }
  return messages
}

export interface TaskSnapshot {
  ledger: LedgerStep[] | null
  verificationSource: string | null
}

export function lastTaskSnapshot(events: JournalEvent[]): TaskSnapshot | null {
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
