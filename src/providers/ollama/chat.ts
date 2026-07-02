import type { Message, Role, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import { Config } from '../../config.ts'
import { RequestCancelledError } from '../cancel.ts'
import { recordContextUsage } from '../context-usage.ts'
import { startIdleTimeout } from '../idle-timeout.ts'
import { readResponseLines } from '../stream-lines.ts'
import { getContextWindowTokenLimit } from './context-window.ts'
import { getThinkingModeFor } from './thinking.ts'

const OLLAMA_HOST = Config.OLLAMA_HOST
const REQUEST_IDLE_TIMEOUT_MS = Config.REQUEST_TIMEOUT_MS
const REQUEST_FIRST_TOKEN_TIMEOUT_MS = Config.REQUEST_FIRST_TOKEN_TIMEOUT_MS

const VALID_ROLES: readonly Role[] = ['system', 'user', 'assistant', 'tool']

function reportContextUsage(promptTokens: unknown, completionTokens: unknown): void {
  if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
    recordContextUsage(promptTokens, completionTokens)
  }
}

export interface ChatOptions {
  tools?: ToolDefinition[]
  format?: object
  onStreamPart?: OnStreamPart
  signal?: AbortSignal
}

export async function chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
  const { tools, format, onStreamPart, signal: userSignal } = options
  const shouldStream = Boolean(onStreamPart) && Config.USE_STREAMING

  const idle = startIdleTimeout(REQUEST_IDLE_TIMEOUT_MS, REQUEST_FIRST_TOKEN_TIMEOUT_MS)
  const signal = userSignal ? AbortSignal.any([idle.signal, userSignal]) : idle.signal

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(messages, shouldStream, tools, format)),
      signal,
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
    }

    return shouldStream
      ? await readStreamingResponse(response, onStreamPart!, idle.refresh)
      : await readCompleteResponse(response)
  }
  catch (error) {
    if (userSignal?.aborted) {
      throw new RequestCancelledError()
    }
    if (idle.abortedByTimeout()) {
      throw new Error(idle.abortedBeforeFirstChunk()
        ? `Ollama request timed out: no response within ${Math.round(REQUEST_FIRST_TOKEN_TIMEOUT_MS / 1000)}s (the model may still be loading or the prompt is too large)`
        : `Ollama request timed out: stream stalled, no data for ${Math.round(REQUEST_IDLE_TIMEOUT_MS / 1000)}s`)
    }
    throw error
  }
  finally {
    idle.stop()
  }
}

function toOllamaMessages(messages: Message[]): object[] {
  return messages.map((message) => {
    if (!message.images?.length) {
      return message
    }
    return { ...message, images: message.images.map(image => image.base64) }
  })
}

function buildRequestBody(messages: Message[], shouldStream: boolean, tools?: ToolDefinition[], format?: object): Record<string, unknown> {
  const model = Config.MODEL
  return {
    model,
    messages: toOllamaMessages(messages),
    tools,
    format,
    think: getThinkingModeFor(model),
    stream: shouldStream,
    options: {
      num_ctx: getContextWindowTokenLimit(),
      temperature: Config.TEMPERATURE,
    },
  }
}

async function readCompleteResponse(response: Response): Promise<Message> {
  const envelope = await response.json() as { message?: unknown, prompt_eval_count?: unknown, eval_count?: unknown }
  const message = envelope?.message

  if (!message || typeof message !== 'object') {
    throw new Error('Ollama returned unexpected response shape')
  }

  reportContextUsage(envelope.prompt_eval_count, envelope.eval_count)

  return message as Message
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

async function readStreamingResponse(response: Response, onStreamPart: OnStreamPart, onActivity: () => void): Promise<Message> {
  const reply: Message = { role: 'assistant', content: '' }

  for await (const rawLine of readResponseLines(response, onActivity)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const parsedLine = parseJsonLine(line)
    if (!parsedLine) {
      continue
    }

    mergeLineIntoMessage(parsedLine, reply, onStreamPart)

    if (parsedLine.done) {
      reportContextUsage(parsedLine.prompt_eval_count, parsedLine.eval_count)
      break
    }
  }

  return reply
}

function mergeLineIntoMessage(line: StreamedLine, reply: Message, onStreamPart: OnStreamPart): void {
  if (line.error) {
    throw new Error(`Ollama stream error: ${line.error}`)
  }

  const partial = line.message
  if (!partial) {
    return
  }

  if (typeof partial.role === 'string' && (VALID_ROLES as readonly string[]).includes(partial.role)) {
    reply.role = partial.role as Role
  }

  if (typeof partial.content === 'string' && partial.content.length > 0) {
    reply.content += partial.content
    onStreamPart({ content: partial.content })
  }

  if (typeof partial.thinking === 'string' && partial.thinking.length > 0) {
    onStreamPart({ thinking: partial.thinking })
  }

  if (Array.isArray(partial.tool_calls) && partial.tool_calls.length > 0) {
    reply.tool_calls = [...(reply.tool_calls ?? []), ...partial.tool_calls as ToolCall[]]
  }
}

function parseJsonLine(rawLine: string): StreamedLine | null {
  try {
    const parsed: unknown = JSON.parse(rawLine)
    return typeof parsed === 'object' && parsed !== null ? parsed as StreamedLine : null
  }
  catch {
    return null
  }
}
