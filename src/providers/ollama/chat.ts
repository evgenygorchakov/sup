// Chat against Ollama's native /api/chat endpoint.
//
// Ollama's wire format already matches our internal Message shape, so there is
// no translation here — just assembling the request and folding the streamed
// newline-delimited JSON back into a single Message.

import type { Message, Role, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import { Config, getThinkingModeFor } from '../../config.ts'
import { recordContextUsage } from '../context-usage.ts'
import { startIdleTimeout } from '../idle-timeout.ts'
import { readResponseLines } from '../stream-lines.ts'
import { getContextWindowTokenLimit } from './context-window.ts'

const OLLAMA_HOST = Config.HOST
const REQUEST_IDLE_TIMEOUT_MS = Config.REQUEST_TIMEOUT_MS

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
}

export async function chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
  const { tools, format, onStreamPart } = options
  const shouldStream = Boolean(onStreamPart) && Config.USE_STREAMING

  const idle = startIdleTimeout(REQUEST_IDLE_TIMEOUT_MS)

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(messages, shouldStream, tools, format)),
      signal: idle.signal,
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`)
    }

    return shouldStream
      ? await readStreamingResponse(response, onStreamPart!, idle.refresh)
      : await readCompleteResponse(response)
  }
  catch (error) {
    if (idle.abortedByTimeout()) {
      throw new Error(`Ollama request timed out: no data for ${Math.round(REQUEST_IDLE_TIMEOUT_MS / 1000)}s`)
    }
    throw error
  }
  finally {
    idle.stop()
  }
}

// Ollama's wire format matches our Message shape except for images, which it
// expects as a flat array of base64 strings on the message (no data-URI prefix).
function toOllamaMessages(messages: Message[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (!message.images?.length) {
      return message
    }
    return { ...message, images: message.images.map(image => image.data) }
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

// --- Streaming: newline-delimited JSON -> internal Message ---

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
    reply.tool_calls = partial.tool_calls as ToolCall[]
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
