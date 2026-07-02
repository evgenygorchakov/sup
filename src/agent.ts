import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './providers/types.ts'
import type { Message, ToolCall } from './types.ts'
import type { OnStreamPart } from './ui/interactive/stream-printer.ts'

import process from 'node:process'
import { buildHarnessReminder, finishTask, recordAssistant, recordLedgerState, recordToolCall, recordToolResult, runCompletionGate, startTurn } from './babysitter/index.ts'
import { Config } from './config.ts'
import { collapseOldToolResults } from './context/collapse.ts'
import { clearActivePlan } from './plan/active-plan.ts'
import { isPlanModeActive, setMode } from './plan/mode-state.ts'
import { shouldAutoApprove } from './tools/auto-approve.ts'
import { runTool, toolDefinitions, toolsByName } from './tools/registry.ts'
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

function pushUnexecutedToolResults(messages: Message[], calls: ToolCall[], content: string): void {
  for (const call of calls) {
    messages.push({ role: 'tool', content, tool_call_id: call.id })
    recordToolResult(call, content)
  }
}

function lastBatchesAreIdentical(signatures: string[], threshold: number): boolean {
  if (signatures.length < threshold) {
    return false
  }
  const tail = signatures.slice(-threshold)
  return tail.every(item => item === tail[0])
}

function withPlanReminder(messages: Message[]): Message[] {
  const reminder = buildHarnessReminder()
  if (!reminder || messages[messages.length - 1]?.role !== 'tool') {
    return messages
  }
  return [...messages, reminder]
}

export interface RunOptions {
  skipPlanApproval?: boolean
}

export async function run(provider: ChatProvider, messages: Message[], readline: ReadlineInterface, options: RunOptions = {}): Promise<void> {
  startTurn(messages)

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

    const { onStreamPart, didPrintAnything, didPrintContent } = createStreamPrinter(text => text)

    const spinner = startSpinner('Thinking…')
    const handleStreamPart: OnStreamPart = (part) => {
      spinner.stop()
      onStreamPart(part)
    }

    let reply: Message
    try {
      reply = await withRequestInterrupt(signal =>
        provider.chat(withPlanReminder(messages), toolDefinitions, handleStreamPart, signal))
    }
    finally {
      spinner.stop()
    }

    messages.push(reply)
    recordAssistant(reply)

    if (!reply.tool_calls?.length) {
      if (didPrintAnything()) {
        process.stderr.write('\n')
      }

      const gateDecision = await runCompletionGate(messages, readline)
      if (gateDecision === 'continue') {
        continue
      }

      finishTask()
      clearActivePlan()

      if (!didPrintContent() && reply.content) {
        console.warn(reply.content)
      }

      return
    }

    if (didPrintAnything()) {
      process.stderr.write('\n')
    }

    iterations += 1
    if (iterations > stepBudget) {
      console.error(red(`Reached max tool iterations (${stepBudget}). Stopping this turn.`))
      pushUnexecutedToolResults(messages, reply.tool_calls, STOPPED_TOOL_RESULT)
      messages.push({ role: 'user', content: `Stopped: exceeded ${stepBudget} tool calls in a single turn. Summarize progress and wait for the user.` })
      return
    }

    recentBatchSignatures.push(buildBatchSignature(reply.tool_calls))

    if (lastBatchesAreIdentical(recentBatchSignatures, Config.AUTONOMOUS_REPEAT_THRESHOLD)) {
      console.error(red(`Detected ${Config.AUTONOMOUS_REPEAT_THRESHOLD} identical tool batches in a row. Stopping autonomous loop.`))
      pushUnexecutedToolResults(messages, reply.tool_calls, STOPPED_TOOL_RESULT)
      messages.push({
        role: 'user',
        content: `Stopped: same tool calls repeated ${Config.AUTONOMOUS_REPEAT_THRESHOLD} times in a row. Reconsider the approach and wait for the user.`,
      })
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
        messages.push({ role: 'user', content: decision.feedback })
        continue
      }
    }

    for (const call of reply.tool_calls) {
      recordToolCall(call)
      const toolResult = await runTool(call)
      recordToolResult(call, toolResult)
      messages.push({ role: 'tool', content: toolResult, tool_call_id: call.id })
    }

    recordLedgerState()
  }
}
