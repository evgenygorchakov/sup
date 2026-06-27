import type { Message, Role, ToolCall, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import { Config } from '../../config.ts'
import { RequestCancelledError } from '../cancel.ts'
import { recordContextUsage } from '../context-usage.ts'
import { startIdleTimeout } from '../idle-timeout.ts'
import { readResponseLines } from '../stream-lines.ts'

const LLAMACPP_HOST = Config.LLAMACPP_HOST
const REQUEST_IDLE_TIMEOUT_MS = Config.REQUEST_TIMEOUT_MS
const REQUEST_FIRST_TOKEN_TIMEOUT_MS = Config.REQUEST_FIRST_TOKEN_TIMEOUT_MS

function reportContextUsage(promptTokens: unknown, completionTokens: unknown): void {
  if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
    recordContextUsage(promptTokens, completionTokens)
  }
}

export interface ChatOptions {
  tools?: ToolDefinition[]
  responseFormat?: object
  onStreamPart?: OnStreamPart
  signal?: AbortSignal
}

export async function chat(messages: Message[], options: ChatOptions = {}): Promise<Message> {
  const { tools, responseFormat, onStreamPart, signal: userSignal } = options
  const shouldStream = Boolean(onStreamPart) && Config.USE_STREAMING

  const idle = startIdleTimeout(REQUEST_IDLE_TIMEOUT_MS, REQUEST_FIRST_TOKEN_TIMEOUT_MS)
  const signal = userSignal ? AbortSignal.any([idle.signal, userSignal]) : idle.signal

  try {
    const response = await fetch(`${LLAMACPP_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(messages, shouldStream, tools, responseFormat)),
      signal,
    })

    if (!response.ok) {
      throw new Error(`llama.cpp HTTP ${response.status}: ${await response.text()}`)
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
        ? `llama.cpp request timed out: no response within ${Math.round(REQUEST_FIRST_TOKEN_TIMEOUT_MS / 1000)}s (the model may still be loading or the prompt is too large)`
        : `llama.cpp request timed out: stream stalled, no data for ${Math.round(REQUEST_IDLE_TIMEOUT_MS / 1000)}s`)
    }
    throw error
  }
  finally {
    idle.stop()
  }
}

function buildRequestBody(messages: Message[], shouldStream: boolean, tools?: ToolDefinition[], responseFormat?: object): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: Config.MODEL,
    messages: toOpenAiMessages(messages),
    stream: shouldStream,
    temperature: Config.TEMPERATURE,
  }

  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  if (responseFormat) {
    body.response_format = responseFormat
  }
  if (shouldStream) {
    body.stream_options = { include_usage: true }
  }

  return body
}

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string, arguments: string }
}

type ContentPart
  = | { type: 'text', text: string }
    | { type: 'image_url', image_url: { url: string } }

interface OpenAiMessage {
  role: Role
  content: string | ContentPart[] | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

function toMultipartContent(text: string, images: NonNullable<Message['images']>): ContentPart[] {
  const parts: ContentPart[] = []
  if (text) {
    parts.push({ type: 'text', text })
  }
  for (const image of images) {
    parts.push({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })
  }
  return parts
}

function toOpenAiMessages(messages: Message[]): OpenAiMessage[] {
  const pendingToolCallIds: string[] = []
  let generatedIdCount = 0
  const nextGeneratedId = (): string => `call_${generatedIdCount++}`

  return messages.map((message): OpenAiMessage => {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const toolCalls = message.tool_calls.map((call): OpenAiToolCall => {
        const id = call.id ?? nextGeneratedId()
        pendingToolCallIds.push(id)
        return {
          id,
          type: 'function',
          function: {
            name: call.function.name,
            arguments: JSON.stringify(call.function.arguments ?? {}),
          },
        }
      })
      return { role: message.role, content: message.content || null, tool_calls: toolCalls }
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id ?? pendingToolCallIds.shift() ?? nextGeneratedId()
      return { role: message.role, content: message.content, tool_call_id: toolCallId }
    }

    if (message.images?.length) {
      return { role: message.role, content: toMultipartContent(message.content, message.images) }
    }

    return { role: message.role, content: message.content }
  })
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

interface ResponseToolCall {
  id?: unknown
  function?: { name?: unknown, arguments?: unknown }
}

function mapToolCalls(rawToolCalls: unknown): ToolCall[] | undefined {
  if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {
    return undefined
  }

  const calls: ToolCall[] = []
  for (const entry of rawToolCalls as ResponseToolCall[]) {
    const name = entry?.function?.name
    if (typeof name !== 'string') {
      continue
    }
    calls.push({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      function: { name, arguments: parseArguments(entry.function?.arguments) },
    })
  }

  return calls.length ? calls : undefined
}

async function readCompleteResponse(response: Response): Promise<Message> {
  const body = await response.json() as {
    choices?: { message?: { content?: unknown, tool_calls?: unknown } }[]
    usage?: { prompt_tokens?: unknown, completion_tokens?: unknown }
  }
  const message = body.choices?.[0]?.message

  if (!message || typeof message !== 'object') {
    throw new Error('llama.cpp returned unexpected response shape')
  }

  reportContextUsage(body.usage?.prompt_tokens, body.usage?.completion_tokens)

  return {
    role: 'assistant',
    content: typeof message.content === 'string' ? message.content : '',
    tool_calls: mapToolCalls(message.tool_calls),
  }
}

interface StreamDelta {
  content?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
  tool_calls?: { index?: unknown, id?: unknown, function?: { name?: unknown, arguments?: unknown } }[]
}

interface StreamChunk {
  choices?: { delta?: StreamDelta }[]
  usage?: { prompt_tokens?: unknown, completion_tokens?: unknown }
  error?: unknown
}

interface ToolCallAccumulator {
  id?: string
  name: string
  arguments: string
}

async function readStreamingResponse(response: Response, onStreamPart: OnStreamPart, onActivity: () => void): Promise<Message> {
  const reply: Message = { role: 'assistant', content: '' }
  const toolCalls = new Map<number, ToolCallAccumulator>()

  for await (const rawLine of readResponseLines(response, onActivity)) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) {
      continue
    }

    const payload = line.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      break
    }

    const chunk = parseJsonChunk(payload)
    if (chunk) {
      applyChunk(chunk, reply, toolCalls, onStreamPart)
    }
  }

  reply.tool_calls = finalizeToolCalls(toolCalls)
  return reply
}

function applyChunk(chunk: StreamChunk, reply: Message, toolCalls: Map<number, ToolCallAccumulator>, onStreamPart: OnStreamPart): void {
  if (chunk.error) {
    throw new Error(`llama.cpp stream error: ${typeof chunk.error === 'string' ? chunk.error : JSON.stringify(chunk.error)}`)
  }

  if (chunk.usage) {
    reportContextUsage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
  }

  const delta = chunk.choices?.[0]?.delta
  if (!delta) {
    return
  }

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    reply.content += delta.content
    onStreamPart({ content: delta.content })
  }

  const reasoning = extractReasoning(delta)
  if (reasoning.length > 0) {
    onStreamPart({ thinking: reasoning })
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const part of delta.tool_calls) {
      const index = typeof part.index === 'number' ? part.index : 0
      const entry = toolCalls.get(index) ?? { name: '', arguments: '' }
      if (typeof part.id === 'string') {
        entry.id = part.id
      }
      if (typeof part.function?.name === 'string' && part.function.name.length > 0) {
        entry.name = part.function.name
      }
      if (typeof part.function?.arguments === 'string') {
        entry.arguments += part.function.arguments
      }
      toolCalls.set(index, entry)
    }
  }
}

function extractReasoning(delta: StreamDelta): string {
  if (typeof delta.reasoning_content === 'string') {
    return delta.reasoning_content
  }
  if (typeof delta.reasoning === 'string') {
    return delta.reasoning
  }
  return ''
}

function finalizeToolCalls(toolCalls: Map<number, ToolCallAccumulator>): ToolCall[] | undefined {
  if (toolCalls.size === 0) {
    return undefined
  }

  const calls = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, entry]): ToolCall => ({
      id: entry.id,
      function: { name: entry.name, arguments: parseArguments(entry.arguments) },
    }))
    .filter(call => call.function.name.length > 0)

  return calls.length ? calls : undefined
}

function parseJsonChunk(rawPayload: string): StreamChunk | null {
  try {
    const parsed: unknown = JSON.parse(rawPayload)
    return typeof parsed === 'object' && parsed !== null ? parsed as StreamChunk : null
  }
  catch {
    return null
  }
}
