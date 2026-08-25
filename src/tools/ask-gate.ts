import type { ToolCall } from '../types.ts'

export const ASK_USER_MIN_TOOL_CALLS = 2

const INVESTIGATION_TOOLS = new Set([
  'read_file',
  'grep',
  'glob',
  'run_shell',
  'fetch_url',
  'web_search',
  'skill',
])

interface TurnState {
  investigated: number
  asked: boolean
}

const turn: TurnState = { investigated: 0, asked: false }

export function resetAskGate(): void {
  turn.investigated = 0
  turn.asked = false
}

export function noteAskGateCall(call: ToolCall): void {
  if (INVESTIGATION_TOOLS.has(call.function.name)) {
    turn.investigated += 1
  }
}

export function checkAskGate(): string | null {
  if (turn.investigated < ASK_USER_MIN_TOOL_CALLS) {
    return [
      `you have investigated ${turn.investigated} time${turn.investigated === 1 ? '' : 's'} this turn, and a question needs at least ${ASK_USER_MIN_TOOL_CALLS}.`,
      'Most answers are in the project, not in the user\'s head: read the relevant files with read_file, grep or glob first.',
      'If the answer really is not there, reply in plain text instead of calling this tool.',
    ].join(' ')
  }

  if (turn.asked) {
    return [
      'you have already asked your one question this turn.',
      'Decide the rest yourself, say plainly what you assumed, and carry on.',
    ].join(' ')
  }

  return null
}

export function noteQuestionAsked(): void {
  turn.asked = true
}
