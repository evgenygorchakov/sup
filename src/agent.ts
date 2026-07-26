import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './providers/types.ts'
import type { CutOffReason, Message, ToolCall } from './types.ts'
import type { OnStreamPart } from './ui/interactive/stream-printer.ts'

import process from 'node:process'
import { beginTurn, buildHarnessReminder, finishTask, noteToolCall, recordLedgerState, runCompletionGate } from './babysitter/index.ts'
import { Config } from './config.ts'
import { collapseOldToolResults } from './context/collapse.ts'
import { recordAssistant, recordFinish, recordToolCall, recordToolResult, recordUserMessage, startRun } from './journal/index.ts'
import { buildPersonaReminder } from './persona.ts'
import { clearActivePlan } from './plan/active-plan.ts'
import { isPlanModeActive, setMode } from './plan/mode-state.ts'
import { shouldAutoApprove } from './tools/auto-approve.ts'
import { runTool, toolDefinitions, toolsByName } from './tools/registry.ts'
import { getSpeaker } from './tts/speaker.ts'
import { buildVoiceStyleReminder } from './tts/voice-style.ts'
import { CONFIRM_KIND, confirmToolCalls } from './ui/interactive/confirm.ts'
import { withRequestInterrupt } from './ui/interactive/interrupt.ts'
import { askForPlanApproval } from './ui/interactive/plan-approval.ts'
import { renderToolHeader } from './ui/interactive/render-tool-call.ts'
import { startSpinner } from './ui/interactive/spinner.ts'
import { createStreamPrinter } from './ui/interactive/stream-printer.ts'
import { red, yellow } from './utils/colors.ts'

function stableStringifyArguments(value: Record<string, unknown>): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return Object.fromEntries(Object.entries(entry).sort(([first], [second]) => first.localeCompare(second)))
    }
    return entry
  })
}

function buildBatchSignature(calls: ToolCall[]): string {
  return calls
    .map(call => `${call.function.name}::${stableStringifyArguments(call.function.arguments)}`)
    .join('|')
}

const REJECTED_TOOL_RESULT = 'Rejected by user. Do not run this command.'
const STOPPED_TOOL_RESULT = 'Not executed: the harness stopped this turn.'

const STOPPED_SUMMARY_REQUEST = [
  'Tools are disabled for this one reply only and work again from your next turn on, so do not call any right now.',
  'Tell the user what you already finished, what is still undone, and what you suggest doing next.',
  'Be brief and concrete: name the files and the results you actually saw, and do not claim work you did not do.',
].join(' ')

const CUT_OFF_CONSOLE_MESSAGES: Record<CutOffReason, string> = {
  'content-loop': 'Model got stuck repeating itself. Response truncated.',
  'thinking-loop': 'Model got stuck repeating itself while thinking. Response stopped.',
  'thinking-flood': 'Model exceeded the thinking length limit. Response stopped.',
}

const CUT_OFF_NOTICES: Record<CutOffReason, string> = {
  'content-loop': 'Stopped: your reply degenerated into repeating the same text and was truncated at the first repetition. Do not produce that text again. Take a different approach or wait for the user.',
  'thinking-loop': 'Stopped: your thinking degenerated into repeating the same text. Think briefly and answer directly, or wait for the user.',
  'thinking-flood': 'Stopped: your thinking exceeded the length limit. Think briefly and answer directly, or wait for the user.',
}

function pushUnexecutedToolResults(messages: Message[], calls: ToolCall[], content: string): void {
  for (const call of calls) {
    messages.push({ role: 'tool', content, tool_call_id: call.id })
    recordToolResult(call, content)
  }
}

function pushUserNotice(messages: Message[], content: string): void {
  const message: Message = { role: 'user', content }
  messages.push(message)
  recordUserMessage(message)
}

function lastBatchesAreIdentical(signatures: string[], threshold: number): boolean {
  if (signatures.length < threshold) {
    return false
  }
  const tail = signatures.slice(-threshold)
  return tail.every(item => item === tail[0])
}

function withReminders(messages: Message[], willBeSpoken: boolean): Message[] {
  const reminders: string[] = []
  const last = messages[messages.length - 1]

  if (last?.role === 'tool') {
    const harnessReminder = buildHarnessReminder()
    if (harnessReminder) {
      reminders.push(harnessReminder.content)
    }
  }

  const voiceReminder = willBeSpoken ? buildVoiceStyleReminder() : null
  if (voiceReminder) {
    reminders.push(voiceReminder)
  }

  const personaReminder = buildPersonaReminder()
  if (personaReminder) {
    reminders.push(personaReminder)
  }

  if (reminders.length === 0) {
    return messages
  }

  const reminder = reminders.join('\n\n')
  if (last?.role === 'user') {
    return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${reminder}` }]
  }
  return [...messages, { role: 'user', content: reminder }]
}

async function stopTurnWithSummary(provider: ChatProvider, messages: Message[], calls: ToolCall[], reason: string): Promise<void> {
  pushUnexecutedToolResults(messages, calls, STOPPED_TOOL_RESULT)
  pushUserNotice(messages, `${reason}\n\n${STOPPED_SUMMARY_REQUEST}`)

  const { onStreamPart, didPrintAnything, didPrintContent } = createStreamPrinter()

  const spinner = startSpinner('Summarizing…')
  const handleStreamPart: OnStreamPart = (part) => {
    spinner.stop()
    onStreamPart(part)
  }

  let reply: Message
  try {
    reply = await withRequestInterrupt(signal =>
      provider.chat(withReminders(messages, false), [], handleStreamPart, signal))
  }
  finally {
    spinner.stop()
  }

  if (didPrintAnything()) {
    process.stderr.write('\n')
  }

  const summary = reply.content.trim()
  if (!summary) {
    return
  }

  const summaryMessage: Message = { role: 'assistant', content: summary }
  messages.push(summaryMessage)
  recordAssistant(summaryMessage)

  if (!didPrintContent()) {
    console.warn(summary)
  }
}

export interface RunOptions {
  skipPlanApproval?: boolean
}

export async function run(provider: ChatProvider, messages: Message[], readline: ReadlineInterface, options: RunOptions = {}): Promise<void> {
  getSpeaker().stop()
  startRun(messages)
  beginTurn()

  if (!options.skipPlanApproval && isPlanModeActive() && messages[messages.length - 1]?.role === 'user') {
    if (!process.stdin.isTTY) {
      console.warn(yellow('Plan mode needs an interactive terminal to approve plans. Running this turn without one.'))
    }
    else {
      const requestIndex = messages.length - 1
      const decision = await askForPlanApproval(provider, messages, readline)

      if (decision === 'quit') {
        messages.length = requestIndex
        console.warn(yellow('Plan rejected and removed from history. Type your message again.'))
        return
      }

      setMode(decision === 'proceed-auto' ? 'auto' : 'normal')
    }
  }

  const stepBudget = Config.AUTONOMOUS_STEP_BUDGET
  const recentBatchSignatures: string[] = []
  let iterations = 0

  while (true) {
    collapseOldToolResults(messages)

    const { onStreamPart, didPrintAnything, didPrintContent } = createStreamPrinter()

    const spinner = startSpinner('Thinking…')
    const handleStreamPart: OnStreamPart = (part) => {
      spinner.stop()
      onStreamPart(part)
    }

    let reply: Message
    try {
      reply = await withRequestInterrupt(signal =>
        provider.chat(withReminders(messages, true), toolDefinitions, handleStreamPart, signal))
    }
    finally {
      spinner.stop()
    }

    messages.push(reply)
    recordAssistant(reply)

    if (reply.cutOff) {
      getSpeaker().stop()
      if (didPrintAnything()) {
        process.stderr.write('\n')
      }
      console.error(red(CUT_OFF_CONSOLE_MESSAGES[reply.cutOff]))
      if (reply.tool_calls?.length) {
        pushUnexecutedToolResults(messages, reply.tool_calls, STOPPED_TOOL_RESULT)
      }
      pushUserNotice(messages, CUT_OFF_NOTICES[reply.cutOff])
      return
    }

    if (!reply.tool_calls?.length) {
      if (didPrintAnything()) {
        process.stderr.write('\n')
      }

      const gateDecision = await runCompletionGate(messages, readline)
      if (gateDecision === 'continue') {
        continue
      }

      recordFinish()
      finishTask()
      clearActivePlan()

      if (!didPrintContent() && reply.content) {
        console.warn(reply.content)
      }

      getSpeaker().speak(reply.content)
      return
    }

    if (didPrintAnything()) {
      process.stderr.write('\n')
    }

    iterations += 1
    if (iterations > stepBudget) {
      console.error(red(`Reached max tool iterations (${stepBudget}). Stopping this turn.`))
      await stopTurnWithSummary(provider, messages, reply.tool_calls, `Stopped by the harness: you exceeded ${stepBudget} tool calls in a single turn.`)
      return
    }

    recentBatchSignatures.push(buildBatchSignature(reply.tool_calls))

    if (lastBatchesAreIdentical(recentBatchSignatures, Config.AUTONOMOUS_REPEAT_THRESHOLD)) {
      console.error(red(`Detected ${Config.AUTONOMOUS_REPEAT_THRESHOLD} identical tool batches in a row. Stopping autonomous loop.`))
      await stopTurnWithSummary(provider, messages, reply.tool_calls, `Stopped by the harness: you repeated the same tool calls ${Config.AUTONOMOUS_REPEAT_THRESHOLD} times in a row.`)
      return
    }

    const canAutoApproveBatch = reply.tool_calls.every(shouldAutoApprove)

    if (canAutoApproveBatch) {
      for (const call of reply.tool_calls) {
        console.warn(renderToolHeader(call, toolsByName[call.function.name]))
      }
    }
    else {
      const decision = await confirmToolCalls(reply.tool_calls, didPrintContent() ? '' : reply.content, readline)

      if (decision.kind === CONFIRM_KIND.quit) {
        pushUnexecutedToolResults(messages, reply.tool_calls, REJECTED_TOOL_RESULT)
        console.error(red('Cancelled by user.'))
        return
      }

      if (decision.kind === CONFIRM_KIND.replan) {
        pushUnexecutedToolResults(messages, reply.tool_calls, REJECTED_TOOL_RESULT)
        pushUserNotice(messages, decision.feedback)
        continue
      }
    }

    for (const call of reply.tool_calls) {
      recordToolCall(call)
      noteToolCall(call)
      const toolResult = await runTool(call)
      recordToolResult(call, toolResult)
      messages.push({ role: 'tool', content: toolResult, tool_call_id: call.id })
    }

    recordLedgerState()
  }
}
