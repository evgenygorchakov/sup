import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from '../../providers/types.ts'
import type { Message, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from './stream-printer.ts'

import process from 'node:process'
import { activatePlan } from '../../babysitter/index.ts'
import { Config } from '../../config.ts'
import { recordAssistant, recordToolCall, recordToolResult, recordUserMessage } from '../../journal/index.ts'
import { setActivePlan } from '../../plan/active-plan.ts'
import { savePlan } from '../../plan/store.ts'
import { noteAskGateCall } from '../../tools/ask-gate.ts'
import { canAutoApproveCall } from '../../tools/auto-approve.ts'
import { ASK_USER_TOOL_NAME } from '../../tools/list/ask-user.ts'
import { autoApprovedToolDefinitions, runTool, toolsByName } from '../../tools/registry.ts'
import { bold, brightBlue, brightGreen, gray, yellow } from '../../utils/colors.ts'
import { FEEDBACK_NOTICE, looksMistyped, readAnswerIntent } from './answer.ts'
import { withRequestInterrupt } from './interrupt.ts'
import { readUserInput } from './multiline-input.ts'
import { renderToolHeader } from './render-tool-call.ts'
import { startSpinner } from './spinner.ts'
import { createStreamPrinter } from './stream-printer.ts'

const MAX_PLAN_EXPLORATION_STEPS = 8

const planShellTool = toolsByName.run_shell
const planShellEnabled = planShellTool !== undefined

const planToolDefinitions = [
  ...autoApprovedToolDefinitions.filter(definition => definition.function.name !== ASK_USER_TOOL_NAME),
  ...(planShellTool === undefined ? [] : [planShellTool.definition]),
]
const planToolNames = new Set(planToolDefinitions.map(definition => definition.function.name))
const planToolNamesList = [...planToolNames].join(', ')

const PLAN_REQUEST_MESSAGE = [
  `Before doing anything, produce an action plan as Markdown. Write the plan in ${Config.LANGUAGE}, but keep the section headings exactly as quoted below, in English.`,
  `First investigate with ${planToolNamesList} so the plan is grounded in the real code — do not plan blind. You have at most ${MAX_PLAN_EXPLORATION_STEPS} rounds of tool calls for investigation — start with the most relevant files. These are the only tools available right now; do not write or edit yet.${planShellEnabled ? ' run_shell is limited to read-only commands (e.g. git status/diff/log, ls) while planning.' : ''}`,
  'When you have enough context, output the plan with these sections:',
  '- "Context" — what is being asked and why, plus the key facts you found while investigating.',
  '- "Steps" — a numbered list of concrete actions. Each step names the specific files, functions, or symbols it changes and how, not a vague action.',
  '- "Affected files" — files/paths you expect to touch (omit if unknown).',
  '- "Verification" — concrete commands or checks that prove the result works.',
  'Do not ask the user questions. If something is ambiguous, make a reasonable assumption and record it in the plan under an "Assumptions" section.',
  'Be specific and complete, not terse. The final plan message must contain only the Markdown plan: no preamble, no closing remarks, no tool calls. Wait for approval.',
].join('\n')

const PLAN_FEEDBACK_MESSAGE = [
  'Revise the plan with this feedback and output the full updated Markdown plan with the same sections.',
  'Everything you read above is still valid — investigate again only where the feedback needs something you have not seen yet.',
].join(' ')

/** `onContentStart` fires once per reply, right before its first character of prose reaches the
 *  screen: that is where the heading belonging to that text has to be printed. */
async function streamPlanReply(provider: ChatProvider, messages: Message[], tools: ToolDefinition[], onContentStart: () => void): Promise<Message> {
  const { onStreamPart, didPrintAnything } = createStreamPrinter({ colorize: yellow })

  const spinner = startSpinner('Planning…')
  const handleStreamPart: OnStreamPart = (part) => {
    spinner.stop()
    if (part.content) {
      onContentStart()
    }
    onStreamPart(part)
  }

  let reply: Message
  try {
    reply = await withRequestInterrupt(signal =>
      provider.chat(messages, tools, handleStreamPart, signal))
  }
  finally {
    spinner.stop()
  }

  if (didPrintAnything()) {
    process.stderr.write('\n')
  }
  else if (reply.content.trim()) {
    onContentStart()
    console.warn(yellow(reply.content.trim()))
  }

  return reply
}

/** Headings that say what is on screen right now. Which round investigates and which one is the plan
 *  is known only once the model starts writing, so a heading is printed by the first line that
 *  belongs under it — the tool header for the investigation, the first token of prose for the plan —
 *  and a section that comes back after the other one gets its heading again. */
function createPlanHeadings(): { investigating: () => void, proposedPlan: () => void } {
  let printed: 'investigation' | 'plan' | null = null

  const show = (section: 'investigation' | 'plan', text: string): void => {
    if (printed === section) {
      return
    }
    printed = section
    console.warn(bold(brightBlue(`\n${text}`)))
  }

  return {
    investigating: () => show('investigation', 'Investigating…'),
    proposedPlan: () => show('plan', 'Proposed plan:'),
  }
}

/** One round of planning, appended to `planMessages` in place: the caller keeps that conversation
 *  across feedback rounds, so a second round continues from what was already read instead of
 *  investigating the same files from scratch. */
async function buildPlan(provider: ChatProvider, planMessages: Message[]): Promise<Message> {
  const headings = createPlanHeadings()

  for (let step = 0; step < MAX_PLAN_EXPLORATION_STEPS; step += 1) {
    const reply = await streamPlanReply(provider, planMessages, planToolDefinitions, headings.proposedPlan)
    planMessages.push(reply)

    if (!reply.tool_calls?.length) {
      if (reply.content.trim()) {
        return reply
      }
      planMessages.push({ role: 'user', content: 'Your last reply was empty. Output the Markdown plan now with the required sections.' })
      continue
    }

    for (const call of reply.tool_calls) {
      if (!planToolNames.has(call.function.name)) {
        planMessages.push({
          role: 'tool',
          content: `Only ${planToolNamesList} are available while planning. Do not call this tool now.`,
          tool_call_id: call.id,
        })
        continue
      }

      if (call.function.name === 'run_shell' && !canAutoApproveCall(call)) {
        planMessages.push({
          role: 'tool',
          content: 'Only allowlisted read-only shell commands (e.g. git status/diff/log, ls) without pipes or chaining are available while planning. Do not run this command now.',
          tool_call_id: call.id,
        })
        continue
      }

      headings.investigating()
      console.warn(renderToolHeader(call, toolsByName[call.function.name]))
      // Reading done here is what the executing turn starts from, so it earns that turn its question.
      noteAskGateCall(call)
      planMessages.push({ role: 'tool', content: await runTool(call), tool_call_id: call.id })
    }
  }

  planMessages.push({ role: 'user', content: 'Stop exploring. Output the final Markdown plan now using what you already know.' })

  const reply = await streamPlanReply(provider, planMessages, [], headings.proposedPlan)
  planMessages.push(reply)

  return reply
}

/** What the model learned while planning: its tool calls and their results, without the planning
 *  prompts, the superseded drafts or the feedback. Handed to the executing turn on approval so it
 *  does not read the same files all over again. */
function investigationMessages(planMessages: Message[], from: number): Message[] {
  return planMessages
    .slice(from)
    .filter(message => message.role === 'tool' || (message.role === 'assistant' && Boolean(message.tool_calls?.length)))
}

/** The journal gets the whole planning block at once, request included: until the plan is approved
 *  nothing of it is written, so a rejected plan cannot come back through `--resume`. Tool calls and
 *  results go in the same shape a normal turn writes them, so a resumed session gets the
 *  investigation back too, paired with the assistant message that asked for it. */
function journalApprovedTurn(messages: Message[], from: number): void {
  const callsById = new Map<string, ToolCall>()

  for (const message of messages.slice(from)) {
    if (message.role === 'assistant') {
      recordAssistant(message)
      for (const call of message.tool_calls ?? []) {
        callsById.set(call.id ?? '', call)
        recordToolCall(call)
      }
    }
    else if (message.role === 'tool') {
      const call = callsById.get(message.tool_call_id ?? '')
        ?? { id: message.tool_call_id, function: { name: 'unknown', arguments: {} } }
      recordToolResult(call, message.content)
    }
    else {
      recordUserMessage(message)
    }
  }
}

export type PlanApprovalDecision = 'proceed' | 'proceed-auto' | 'quit'

export async function askForPlanApproval(provider: ChatProvider, messages: Message[], readline: ReadlineInterface): Promise<PlanApprovalDecision> {
  const requestIndex = messages.length - 1
  const userRequest = String(messages[requestIndex]?.content ?? '')

  // Planning runs on its own copy of the history and stays there until the plan is approved: the
  // main history sees no draft, no feedback and nothing at all if the plan is rejected.
  const planMessages: Message[] = [...messages, { role: 'user', content: PLAN_REQUEST_MESSAGE }]
  const investigationStart = planMessages.length

  while (true) {
    const plan = await buildPlan(provider, planMessages)
    const planText = plan.content.trim()

    if (!planText) {
      console.warn(yellow('The model did not produce a plan.'))
      return 'quit'
    }

    let userAnswer = ''
    while (!userAnswer) {
      userAnswer = (await readUserInput(readline, brightGreen('\n[y / a = y + auto-approve edits for this task / n / type feedback] '))).trim()
    }
    const intent = readAnswerIntent(userAnswer)

    if (intent === 'yes' || intent === 'auto') {
      messages.push(...investigationMessages(planMessages, investigationStart))
      messages.push({ role: 'assistant', content: plan.content })
      messages.push({
        role: 'user',
        content: 'The plan above is approved. All tools are available now, including write_file and edit_file. Execute the steps in order, starting with step 1. The tool results above are what the plan was built on — do not read those files again unless you need something they do not show. After the last step, run the checks from the "Verification" section.',
      })

      journalApprovedTurn(messages, requestIndex)

      setActivePlan(plan.content)
      activatePlan(plan.content)

      const savedPath = await savePlan(plan.content, userRequest)
      if (savedPath) {
        console.warn(gray(`Saved plan to ${savedPath}`))
      }

      return intent === 'auto' ? 'proceed-auto' : 'proceed'
    }

    if (intent === 'no') {
      return 'quit'
    }

    if (looksMistyped(userAnswer)) {
      console.warn(gray(FEEDBACK_NOTICE))
    }

    planMessages.push({ role: 'user', content: `${userAnswer}\n\n${PLAN_FEEDBACK_MESSAGE}` })
  }
}
