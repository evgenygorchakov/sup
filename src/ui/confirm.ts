import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ToolCall } from '../types.ts'

import { toolsByName } from '../tools/registry.ts'
import { bold, brightBlue, brightGreen, yellow } from '../utils/colors.ts'
import { renderToolHeader } from './render-tool-call.ts'

export const CONFIRM_KIND = {
  approve: 'approve',
  replan: 'replan',
  quit: 'quit',
} as const

export type ConfirmResult
  = | { kind: typeof CONFIRM_KIND.approve }
    | { kind: typeof CONFIRM_KIND.replan, feedback: string }
    | { kind: typeof CONFIRM_KIND.quit }

export async function confirmToolCalls(calls: ToolCall[], fallbackIntent: string, readline: ReadlineInterface): Promise<ConfirmResult> {
  const intent = fallbackIntent.trim()

  if (intent) {
    console.warn(`\n${yellow(intent)}`)
  }

  console.warn(bold(brightBlue('\nModel wants to run:')))

  for (const call of calls) {
    console.warn(renderToolHeader(call, toolsByName[call.function.name]))
  }

  const userAnswer = (await readline.question(brightGreen('\n[y / n / type feedback] '))).trim()
  const loweredAnswer = userAnswer.toLowerCase()

  if (loweredAnswer === 'y') {
    return { kind: CONFIRM_KIND.approve }
  }

  if (!userAnswer || loweredAnswer === 'n') {
    return { kind: CONFIRM_KIND.quit }
  }

  return { kind: CONFIRM_KIND.replan, feedback: userAnswer }
}
