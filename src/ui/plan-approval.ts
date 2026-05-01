import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from '../providers/types.ts'
import type { Message } from '../types.ts'
import process from 'node:process'

import { Config } from '../config.ts'
import { bold, brightBlue, brightGreen, yellow } from '../utils/colors.ts'
import { createStreamPrinter } from './stream-printer.ts'

const PLAN_REQUEST_MESSAGE = `Before doing anything, describe in 2-4 short sentences in ${Config.LANGUAGE} what you plan to do to answer the user. Do not call tools. Wait for approval.`

export async function askForPlanApproval(provider: ChatProvider, messages: Message[], readline: ReadlineInterface): Promise<'proceed' | 'quit'> {
  while (true) {
    console.warn(bold(brightBlue('\nProposed plan:')))

    const { onStreamPart, didPrintAnything } = createStreamPrinter(yellow)
    const plan = await provider.chat(
      [...messages, { role: 'user', content: PLAN_REQUEST_MESSAGE }],
      [],
      onStreamPart,
    )

    if (didPrintAnything()) {
      process.stderr.write('\n')
    }
    else {
      const planText = plan.content.trim()
      if (planText) {
        console.warn(yellow(planText))
      }
    }

    const userAnswer = (await readline.question(brightGreen('\n[y / n / type feedback] '))).trim()
    const loweredAnswer = userAnswer.toLowerCase()

    if (loweredAnswer === 'y') {
      messages.push(plan)
      return 'proceed'
    }

    if (!userAnswer || loweredAnswer === 'n') {
      return 'quit'
    }

    messages.push(plan)
    messages.push({ role: 'user', content: userAnswer })
  }
}
