import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from '../providers/types.ts'
import type { Message } from '../types.ts'
import process from 'node:process'

import { Config } from '../config.ts'
import { savePlan } from '../plan-store.ts'
import { bold, brightBlue, brightGreen, gray, yellow } from '../utils/colors.ts'
import { createStreamPrinter } from './stream-printer.ts'

const PLAN_REQUEST_MESSAGE = [
  `Before doing anything, write an action plan as Markdown in ${Config.LANGUAGE}.`,
  'Use these sections (translate the headings into that language):',
  '- "Context" — what is being asked and why.',
  '- "Steps" — a numbered list of the concrete actions you will take.',
  '- "Affected files" — files/paths you expect to touch (omit if unknown).',
  '- "Verification" — how the result will be verified.',
  'Output only the Markdown plan: no preamble, no closing remarks, no tool calls. Wait for approval.',
].join('\n')

export async function askForPlanApproval(provider: ChatProvider, messages: Message[], readline: ReadlineInterface): Promise<'proceed' | 'quit'> {
  const userRequest = String(messages[messages.length - 1]?.content ?? '')

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
      messages.push({
        role: 'user',
        content: 'The plan above is approved. Begin executing it now, starting with the first step, and use tools as needed.',
      })

      const savedPath = await savePlan(plan.content, userRequest)
      if (savedPath) {
        console.warn(gray(`Saved plan to ${savedPath}`))
      }

      return 'proceed'
    }

    if (!userAnswer || loweredAnswer === 'n') {
      return 'quit'
    }

    messages.push(plan)
    messages.push({ role: 'user', content: userAnswer })
  }
}
