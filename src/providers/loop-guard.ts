import type { CutOffReason } from '../types.ts'
import { Config } from '../config.ts'

const TAIL_WINDOW_CHARS = 4096
const PROBE_CHARS = 48
const MIN_CYCLE_REPEATS = 4
const MIN_LOOPED_SPAN_CHARS = 300
const CHECK_EVERY_CHARS = 64

export interface LoopGuard {
  pushContent: (chunk: string) => void
  pushThinking: (chunk: string) => void
  cutOffReason: () => CutOffReason | null
  trimLoopedTail: (text: string) => string
}

interface StreamTracker {
  tail: string
  charsSinceCheck: number
  totalChars: number
}

interface DetectedCycle {
  period: number
  extent: number
}

function createTracker(): StreamTracker {
  return { tail: '', charsSinceCheck: 0, totalChars: 0 }
}

function appendToTracker(tracker: StreamTracker, chunk: string): void {
  tracker.tail = (tracker.tail + chunk).slice(-TAIL_WINDOW_CHARS)
  tracker.charsSinceCheck += chunk.length
  tracker.totalChars += chunk.length
}

function periodicSuffixLength(tail: string, period: number): number {
  let index = tail.length - period - 1
  while (index >= 0 && tail[index] === tail[index + period]) {
    index -= 1
  }
  return tail.length - 1 - index
}

function detectCycle(tail: string): DetectedCycle | null {
  if (tail.length < MIN_LOOPED_SPAN_CHARS) {
    return null
  }

  const probe = tail.slice(-PROBE_CHARS)
  const previousMatch = tail.lastIndexOf(probe, tail.length - PROBE_CHARS - 1)
  if (previousMatch === -1) {
    return null
  }

  const period = tail.length - PROBE_CHARS - previousMatch
  const extent = periodicSuffixLength(tail, period)
  if (extent < period * MIN_CYCLE_REPEATS || extent < MIN_LOOPED_SPAN_CHARS) {
    return null
  }

  return { period, extent }
}

export function createLoopGuard(): LoopGuard {
  const enabled = Config.USE_LOOP_DETECTION
  const content = createTracker()
  const thinking = createTracker()
  let reason: CutOffReason | null = null
  let contentCharsToTrim = 0

  const checkForCycle = (tracker: StreamTracker, cycleReason: 'content-loop' | 'thinking-loop'): void => {
    if (tracker.charsSinceCheck < CHECK_EVERY_CHARS) {
      return
    }
    tracker.charsSinceCheck = 0

    const cycle = detectCycle(tracker.tail)
    if (!cycle) {
      return
    }

    reason = cycleReason
    if (cycleReason === 'content-loop') {
      contentCharsToTrim = cycle.extent - cycle.period
    }
  }

  return {
    pushContent: (chunk) => {
      if (!enabled || reason) {
        return
      }
      appendToTracker(content, chunk)
      checkForCycle(content, 'content-loop')
    },
    pushThinking: (chunk) => {
      if (!enabled || reason) {
        return
      }
      appendToTracker(thinking, chunk)
      if (thinking.totalChars > Config.THINKING_CHAR_LIMIT) {
        reason = 'thinking-flood'
        return
      }
      checkForCycle(thinking, 'thinking-loop')
    },
    cutOffReason: () => reason,
    trimLoopedTail: text => contentCharsToTrim > 0 ? text.slice(0, text.length - contentCharsToTrim) : text,
  }
}
