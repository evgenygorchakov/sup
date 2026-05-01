import type { Message, Role, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/stream-printer.ts'
import { Config, getThinkingModeFor } from '../../config.ts'
import { gray } from '../../utils/colors.ts'
import { getContextWindowTokenLimit } from './context-window.ts'

const OLLAMA_HOST = Config.HOST
const OLLAMA_MODEL = Config.MODEL
const REQUEST_TIMEOUT_MS = 300_000

const VALID_ROLES: readonly Role[] = ['system', 'user', 'assistant', 'tool']

function reportContextUsage(promptTokens: unknown, completionTokens: unknown): void {
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') {
    return
  }

  const total = promptTokens + completionTokens
  const limit = getContextWindowTokenLimit()
  const percent = Math.round((total / limit) * 100)
  console.error(gray(`[ctx: ${promptTokens}+${completionTokens} / ${limit} (${percent}%)]`))
}

export interface ChatOptions {
  tools?: ToolDefinition[]
  format?: object
  onStreamPart?: OnStreamPart
}

export async function chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
  const { tools, format, onStreamPart } = options
  const shouldStream = Boolean(onStreamPart) && Config.USE_STREAMING

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      tools,
      format,
      think: getThinkingModeFor(OLLAMA_MODEL),
      stream: shouldStream,
      options: {
        num_ctx: getContextWindowTokenLimit(),
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
  }

  if (!shouldStream) {
    const responseBody: unknown = await response.json()
    const responseEnvelope = responseBody as { message?: unknown, prompt_eval_count?: unknown, eval_count?: unknown }
    const responseMessage = responseEnvelope?.message

    if (!responseMessage || typeof responseMessage !== 'object') {
      throw new Error('Ollama returned unexpected response shape')
    }

    reportContextUsage(responseEnvelope.prompt_eval_count, responseEnvelope.eval_count)

    return responseMessage as Message
  }

  return await readStreamingResponse(response, onStreamPart!)
}

interface StreamedLine {
  message?: {
    role?: unknown
    content?: unknown
    thinking?: unknown
    tool_calls?: unknown
  }
  done?: boolean
  error?: string
  prompt_eval_count?: unknown
  eval_count?: unknown
}

function mergeLineIntoMessage(line: StreamedLine, accumulated: Message, onStreamPart: OnStreamPart): void {
  if (line.error) {
    throw new Error(`Ollama stream error: ${line.error}`)
  }

  const partial = line.message
  if (!partial) {
    return
  }

  if (typeof partial.role === 'string' && (VALID_ROLES as readonly string[]).includes(partial.role)) {
    accumulated.role = partial.role as Role
  }

  if (typeof partial.content === 'string' && partial.content.length > 0) {
    accumulated.content += partial.content
    onStreamPart({ content: partial.content })
  }

  if (typeof partial.thinking === 'string' && partial.thinking.length > 0) {
    onStreamPart({ thinking: partial.thinking })
  }

  if (Array.isArray(partial.tool_calls) && partial.tool_calls.length > 0) {
    accumulated.tool_calls = partial.tool_calls as ToolCall[]
  }
}

async function readStreamingResponse(response: Response, onStreamPart: OnStreamPart): Promise<Message> {
  if (!response.body) {
    throw new Error('Ollama stream has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const accumulatedMessage: Message = { role: 'assistant', content: '' }

  while (true) {
    const { value: bytes, done } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(bytes, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')

      if (!rawLine) {
        continue
      }

      const parsedLine = parseJsonLine(rawLine)
      if (!parsedLine) {
        continue
      }

      mergeLineIntoMessage(parsedLine, accumulatedMessage, onStreamPart)

      if (parsedLine.done) {
        reportContextUsage(parsedLine.prompt_eval_count, parsedLine.eval_count)
        return accumulatedMessage
      }
    }
  }

  const remainingLine = buffer.trim()
  if (remainingLine) {
    const parsedLine = parseJsonLine(remainingLine)
    if (parsedLine) {
      mergeLineIntoMessage(parsedLine, accumulatedMessage, onStreamPart)
    }
  }

  return accumulatedMessage
}

function parseJsonLine(rawLine: string): StreamedLine | null {
  try {
    const parsed: unknown = JSON.parse(rawLine)
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    return parsed as StreamedLine
  }
  catch {
    return null
  }
}
