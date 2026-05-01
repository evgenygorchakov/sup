import type { Tool, ToolCall } from '../types.ts'
import { Config } from '../config.ts'
import { bold, gray, red, yellow } from '../utils/colors.ts'

const MAX_HEADER_VALUE_LENGTH = 80
const MAX_RESULT_LINES = 15
const verboseOutput = Config.VERBOSE_TOOL_OUTPUT

function shortenScalar(value: unknown): string {
  if (typeof value === 'string') {
    if (value.length <= MAX_HEADER_VALUE_LENGTH) {
      return JSON.stringify(value)
    }

    return JSON.stringify(`${value.slice(0, MAX_HEADER_VALUE_LENGTH)}…`)
  }

  return JSON.stringify(value)
}

function renderArgs(tool: Tool | undefined, args: Record<string, unknown>): string {
  const keys = tool?.primaryArgs ?? Object.keys(args)
  const parts: string[] = []

  for (const key of keys) {
    const value = args[key]
    if (value === undefined) {
      continue
    }

    parts.push(`${key}: ${shortenScalar(value)}`)
  }

  return parts.join(', ')
}

export function renderToolHeader(call: ToolCall, tool: Tool | undefined): string {
  const colorize = tool?.accentColor ?? yellow
  return `${colorize('●')} ${bold(`${call.function.name}(${renderArgs(tool, call.function.arguments)})`)}`
}

function withLeafPrefix(text: string): string {
  const lines = text.split('\n')

  return lines
    .map((line, index) => (index === 0 ? `  ⎿  ${line}` : `     ${line}`))
    .join('\n')
}

function truncateByLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return text
  }

  const hidden = lines.length - maxLines

  return `${lines.slice(0, maxLines).join('\n')}\n… +${hidden} more lines`
}

export function renderToolResult(tool: Tool | undefined, call: ToolCall, result: string): string {
  if (result.startsWith('ERROR:')) {
    const errorBody = verboseOutput ? result : truncateByLines(result, MAX_RESULT_LINES)
    return red(withLeafPrefix(errorBody))
  }

  if (verboseOutput) {
    return gray(withLeafPrefix(result))
  }

  const summary = tool?.renderResult
    ? tool.renderResult(call.function.arguments, result)
    : result

  return gray(withLeafPrefix(truncateByLines(summary, MAX_RESULT_LINES)))
}
