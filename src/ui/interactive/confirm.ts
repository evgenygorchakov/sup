import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ToolCall } from '../../types.ts'

import process from 'node:process'
import { toolsByName } from '../../tools/registry.ts'
import { bold, brightBlue, brightGreen, gray, red, yellow } from '../../utils/colors.ts'
import { FEEDBACK_NOTICE, looksMistyped, readAnswerIntent } from './answer.ts'
import { readUserInput } from './multiline-input.ts'
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

  if (!process.stdin.isTTY) {
    console.error(red('\nNo terminal to ask for approval, so the call is refused. Rerun interactively, or start with --dangerously-skip-permissions.'))
    return { kind: CONFIRM_KIND.quit }
  }

  while (true) {
    const userAnswer = (await readUserInput(readline, brightGreen('\n[y / n / type feedback] '))).trim()
    const intent = readAnswerIntent(userAnswer)

    if (intent === 'yes') {
      return { kind: CONFIRM_KIND.approve }
    }

    if (intent === 'no') {
      return { kind: CONFIRM_KIND.quit }
    }

    if (userAnswer) {
      if (looksMistyped(userAnswer)) {
        console.warn(gray(FEEDBACK_NOTICE))
      }
      return { kind: CONFIRM_KIND.replan, feedback: userAnswer }
    }
  }
}
