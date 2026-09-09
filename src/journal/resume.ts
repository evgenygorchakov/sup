import type { Message } from '../types.ts'
import { Config } from '../config.ts'
import { reconstructMessages } from './messages.ts'
import { adoptRun, listRuns, loadRunEvents } from './store.ts'

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

  const restored = reconstructMessages(loadRunEvents(target), target)
  repairTrailingToolCalls(restored)

  for (const message of restored) {
    messages.push(message)
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
