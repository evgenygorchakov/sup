import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from '../providers/types.ts'
import type { Message, ToolDefinition } from '../types.ts'
import process from 'node:process'

import { Config } from '../config.ts'
import { savePlan } from '../plan-store.ts'
import { readOnlyToolDefinitions, runTool, toolsByName } from '../tools/registry.ts'
import { bold, brightBlue, brightGreen, gray, yellow } from '../utils/colors.ts'
import { renderToolHeader } from './render-tool-call.ts'
import { createStreamPrinter } from './stream-printer.ts'

const MAX_PLAN_EXPLORATION_STEPS = 8

const PLAN_REQUEST_MESSAGE = [
  `Before doing anything, produce an action plan as Markdown in ${Config.LANGUAGE}.`,
  'First investigate with read_file, grep, and glob so the plan is grounded in the real code — do not plan blind. These are the only tools available right now; do not write, edit, or run shell yet.',
  'When you have enough context, output the plan with these sections (translate the headings into that language):',
  '- "Context" — what is being asked and why, plus the key facts you found while investigating.',
  '- "Steps" — a numbered list of concrete actions. Each step names the specific files, functions, or symbols it changes and how, not a vague action.',
  '- "Affected files" — files/paths you expect to touch (omit if unknown).',
  '- "Verification" — concrete commands or checks that prove the result works.',
  'Be specific and complete, not terse. The final plan message must contain only the Markdown plan: no preamble, no closing remarks, no tool calls. Wait for approval.',
].join('\n')

const readOnlyNames = new Set(readOnlyToolDefinitions.map(definition => definition.function.name))

async function streamPlanReply(provider: ChatProvider, messages: Message[], tools: ToolDefinition[]): Promise<Message> {
  const { onStreamPart, didPrintAnything } = createStreamPrinter(yellow)
  const reply = await provider.chat(messages, tools, onStreamPart)

  if (didPrintAnything()) {
    process.stderr.write('\n')
  }
  else if (reply.content.trim()) {
    console.warn(yellow(reply.content.trim()))
  }

  return reply
}

async function buildPlan(provider: ChatProvider, messages: Message[]): Promise<Message> {
  const planMessages: Message[] = [...messages, { role: 'user', content: PLAN_REQUEST_MESSAGE }]

  for (let step = 0; step < MAX_PLAN_EXPLORATION_STEPS; step += 1) {
    const reply = await streamPlanReply(provider, planMessages, readOnlyToolDefinitions)
    planMessages.push(reply)

    if (!reply.tool_calls?.length) {
      return reply
    }

    for (const call of reply.tool_calls) {
      if (!readOnlyNames.has(call.function.name)) {
        planMessages.push({
          role: 'tool',
          content: 'Only read_file, grep, and glob are available while planning. Do not call this tool now.',
          tool_call_id: call.id,
        })
        continue
      }

      console.warn(renderToolHeader(call, toolsByName[call.function.name]))
      planMessages.push({ role: 'tool', content: await runTool(call), tool_call_id: call.id })
    }
  }

  planMessages.push({ role: 'user', content: 'Stop exploring. Output the final Markdown plan now using what you already know.' })

  return streamPlanReply(provider, planMessages, [])
}

export async function askForPlanApproval(provider: ChatProvider, messages: Message[], readline: ReadlineInterface): Promise<'proceed' | 'quit'> {
  const userRequest = String(messages[messages.length - 1]?.content ?? '')

  while (true) {
    console.warn(bold(brightBlue('\nProposed plan:')))

    const plan = await buildPlan(provider, messages)

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
