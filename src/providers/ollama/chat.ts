import type { Message, Role, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import type { LoopGuard } from '../loop-guard.ts'
import { Config } from '../../config.ts'
import { RequestCancelledError } from '../cancel.ts'
import { reportContextUsage } from '../context-usage.ts'
import { requestTimeoutError, startIdleTimeout } from '../idle-timeout.ts'
import { createLoopGuard } from '../loop-guard.ts'
import { parseJsonObject, readResponseLines } from '../stream-lines.ts'
import { getContextWindowTokenLimit } from './context-window.ts'
import { getThinkingModeFor } from './thinking.ts'

const OLLAMA_HOST = Config.OLLAMA_HOST
const REQUEST_IDLE_TIMEOUT_MS = Config.REQUEST_TIMEOUT_MS
const REQUEST_FIRST_TOKEN_TIMEOUT_MS = Config.REQUEST_FIRST_TOKEN_TIMEOUT_MS

const VALID_ROLES: readonly Role[] = ['system', 'user', 'assistant', 'tool']

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
      throw requestTimeoutError(idle, 'Ollama', REQUEST_FIRST_TOKEN_TIMEOUT_MS, REQUEST_IDLE_TIMEOUT_MS)
    }
    throw error
  }
  finally {
    idle.stop()
  }
}

function toOllamaMessages(messages: Message[]): object[] {
  return messages.map((message) => {
    const wireMessage: Record<string, unknown> = { role: message.role, content: message.content }
    if (message.tool_calls?.length) {
      wireMessage.tool_calls = message.tool_calls
    }
    if (message.tool_call_id) {
      wireMessage.tool_call_id = message.tool_call_id
    }
    if (message.images?.length) {
      wireMessage.images = message.images.map(image => image.base64)
    }
    return wireMessage
  })
}

function buildRequestBody(messages: Message[], shouldStream: boolean, tools?: ToolDefinition[], format?: object): Record<string, unknown> {
  const model = Config.MODEL
  const options: Record<string, unknown> = {
    num_ctx: getContextWindowTokenLimit(),
    temperature: Config.TEMPERATURE,
  }
  if (Config.MAX_RESPONSE_TOKENS > 0) {
    options.num_predict = Config.MAX_RESPONSE_TOKENS
  }
  if (Config.REPEAT_PENALTY > 0) {
    options.repeat_penalty = Config.REPEAT_PENALTY
  }
  return {
    model,
    messages: toOllamaMessages(messages),
    tools,
    format,
    think: getThinkingModeFor(model),
    stream: shouldStream,
    options,
  }
}

function normalizeToolCallArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    const parsed = parseJsonObject<Record<string, unknown>>(raw)
    return parsed !== null && !Array.isArray(parsed) ? parsed : {}
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined
  }

  const calls: ToolCall[] = []

  for (const entry of raw) {
    const candidate = entry as { id?: unknown, function?: { name?: unknown, arguments?: unknown } } | null
    const name = candidate?.function?.name
    if (typeof name !== 'string' || name.length === 0) {
      continue
    }
    calls.push({
      ...(typeof candidate?.id === 'string' ? { id: candidate.id } : {}),
      function: { name, arguments: normalizeToolCallArguments(candidate?.function?.arguments) },
    })
  }

  return calls.length > 0 ? calls : undefined
}

async function readCompleteResponse(response: Response): Promise<Message> {
  const envelope = await response.json() as {
    message?: { role?: unknown, content?: unknown, tool_calls?: unknown }
    prompt_eval_count?: unknown
    eval_count?: unknown
  }
  const message = envelope.message

  if (!message || typeof message !== 'object') {
    throw new Error('Ollama returned unexpected response shape')
  }

  reportContextUsage(envelope.prompt_eval_count, envelope.eval_count)

  const role = typeof message.role === 'string' && (VALID_ROLES as readonly string[]).includes(message.role)
    ? message.role as Role
    : 'assistant'
  return {
    role,
    content: typeof message.content === 'string' ? message.content : '',
    tool_calls: normalizeToolCalls(message.tool_calls),
  }
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
  const loopGuard = createLoopGuard()

  for await (const rawLine of readResponseLines(response, onActivity)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const parsedLine = parseJsonObject<StreamedLine>(line)
    if (!parsedLine) {
      continue
    }

    mergeLineIntoMessage(parsedLine, reply, onStreamPart, loopGuard)

    const cutOff = loopGuard.cutOffReason()
    if (cutOff) {
      reply.content = loopGuard.trimLoopedTail(reply.content)
      reply.cutOff = cutOff
      break
    }

    if (parsedLine.done) {
      reportContextUsage(parsedLine.prompt_eval_count, parsedLine.eval_count)
      break
    }
  }

  return reply
}

function mergeLineIntoMessage(line: StreamedLine, reply: Message, onStreamPart: OnStreamPart, loopGuard: LoopGuard): void {
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
    loopGuard.pushContent(partial.content)
    onStreamPart({ content: partial.content })
  }

  if (typeof partial.thinking === 'string' && partial.thinking.length > 0) {
    loopGuard.pushThinking(partial.thinking)
    onStreamPart({ thinking: partial.thinking })
  }

  const streamedCalls = normalizeToolCalls(partial.tool_calls)
  if (streamedCalls) {
    reply.tool_calls = [...(reply.tool_calls ?? []), ...streamedCalls]
  }
}
