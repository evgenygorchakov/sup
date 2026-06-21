import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './providers/types.ts'
import type { Message, ToolCall } from './types.ts'
import process from 'node:process'

import { buildHarnessReminder, finishTask, recordAssistant, recordLedgerState, recordToolCall, recordToolResult, runCompletionGate, startTurn } from './babysitter/index.ts'
import { Config } from './config.ts'
import { collapseOldToolResults } from './context/collapse.ts'
import { clearActivePlan } from './plan/active-plan.ts'
import { isPlanModeActive, setPlanModeActive } from './plan/mode-state.ts'
import { shouldAutoApprove } from './tools/auto-approve.ts'
import { runTool, toolDefinitions, toolsByName } from './tools/registry.ts'
import { CONFIRM_KIND, confirmToolCalls } from './ui/interactive/confirm.ts'
import { askForPlanApproval } from './ui/interactive/plan-approval.ts'
import { renderToolHeader } from './ui/interactive/render-tool-call.ts'
import { createStreamPrinter } from './ui/interactive/stream-printer.ts'
import { red } from './utils/colors.ts'

const MAX_TOOL_ITERATIONS = 10

function stableStringifyArguments(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort())
}

function buildBatchSignature(calls: ToolCall[]): string {
  return calls
    .map(call => `${call.function.name}::${stableStringifyArguments(call.function.arguments)}`)
    .join('|')
}

function pushRejectedToolResults(messages: Message[], calls: ToolCall[]): void {
  for (const call of calls) {
    messages.push({
      role: 'tool',
      content: 'Rejected by user. Do not run this command.',
      tool_call_id: call.id,
    })
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
    const decision = await askForPlanApproval(provider, messages, readline)

    if (decision === 'quit') {
      console.error(red('Cancelled by user.'))
      return
    }

    setPlanModeActive(false)
  }

  const stepBudget = Config.USE_AUTONOMOUS_MODE ? Config.AUTONOMOUS_STEP_BUDGET : MAX_TOOL_ITERATIONS
  const recentBatchSignatures: string[] = []
  let iterations = 0

  while (true) {
    collapseOldToolResults(messages)

    const { onStreamPart, didPrintAnything, didPrintContent } = createStreamPrinter(text => text)
    const reply = await provider.chat(withPlanReminder(messages), toolDefinitions, onStreamPart)

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
      messages.push({ role: 'user', content: `Stopped: exceeded ${stepBudget} tool calls in a single turn. Summarize progress and wait for the user.` })
      return
    }

    if (Config.USE_AUTONOMOUS_MODE) {
      recentBatchSignatures.push(buildBatchSignature(reply.tool_calls))

      if (lastBatchesAreIdentical(recentBatchSignatures, Config.AUTONOMOUS_REPEAT_THRESHOLD)) {
        console.error(red(`Detected ${Config.AUTONOMOUS_REPEAT_THRESHOLD} identical tool batches in a row. Stopping autonomous loop.`))
        messages.push({
          role: 'user',
          content: `Stopped: same tool calls repeated ${Config.AUTONOMOUS_REPEAT_THRESHOLD} times in a row. Reconsider the approach and wait for the user.`,
        })
        return
      }
    }

    const canAutoApproveBatch = reply.tool_calls.every(shouldAutoApprove)

    if (canAutoApproveBatch) {
      for (const call of reply.tool_calls) {
        console.warn(renderToolHeader(call, toolsByName[call.function.name]))
      }
    }
    else {
      const decision = await confirmToolCalls(reply.tool_calls, reply.content, readline)

      if (decision.kind === CONFIRM_KIND.quit) {
        pushRejectedToolResults(messages, reply.tool_calls)
        console.error(red('Cancelled by user.'))
        return
      }

      if (decision.kind === CONFIRM_KIND.replan) {
        pushRejectedToolResults(messages, reply.tool_calls)
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
