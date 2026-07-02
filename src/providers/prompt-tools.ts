import type { Message, ToolCall, ToolDefinition } from '../types.ts'
import type { OnStreamPart } from '../ui/interactive/stream-printer.ts'
import process from 'node:process'
import { gray } from '../utils/colors.ts'

export interface PromptToolsReply {
  message: string
  tool_calls: ToolCall[]
}

export function buildToolsInstruction(tools: ToolDefinition[]): string {
  const toolSchemas = tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))

  return [
    'You have access to the following tools:',
    JSON.stringify(toolSchemas),
    '',
    'Your reply is constrained to a JSON object with two fields:',
    '- "message": natural-language text for the user (empty string if you only want to call tools).',
    '- "tool_calls": array of calls you want to execute right now.',
    '',
    'Each entry in tool_calls must have:',
    '- "name": exactly one of the tool names listed above.',
    '- "arguments": object with the tool arguments matching its parameters schema.',
    '',
    'When you are done and want to answer the user, return an empty tool_calls array.',
    'Do not use any tool to echo, cat, print or otherwise emit text you yourself composed. Put user-facing text in "message".',
    '"arguments" must contain ONLY the parameters listed in that tool\'s parameters schema. Do not add "name" or any other extra fields.',
    'Do not include tool output, commentary, or anything outside the JSON object.',
  ].join('\n')
}

export function buildReplyFormat(tools: ToolDefinition[]): object {
  const toolNames = tools.map(tool => tool.function.name)

  return {
    type: 'object',
    properties: {
      message: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', enum: toolNames },
            arguments: { type: 'object' },
          },
          required: ['name', 'arguments'],
        },
      },
    },
    required: ['message', 'tool_calls'],
  }
}

interface ToolCallEntry {
  name: string
  arguments: Record<string, unknown>
}

function isToolCallEntry(value: unknown): value is ToolCallEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entry = value as { name?: unknown, arguments?: unknown }
  return (
    typeof entry.name === 'string'
    && typeof entry.arguments === 'object'
    && entry.arguments !== null
    && !Array.isArray(entry.arguments)
  )
}

export function parsePromptToolsReply(jsonText: string): PromptToolsReply {
  const parsed: unknown = JSON.parse(jsonText)

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Prompt-tools reply is not a JSON object')
  }

  const replyObject = parsed as { message?: unknown, tool_calls?: unknown }
  const hasMessage = typeof replyObject.message === 'string'
  const hasToolCalls = Array.isArray(replyObject.tool_calls)

  if (!hasMessage && !hasToolCalls) {
    throw new Error('Prompt-tools reply missing both "message" and "tool_calls"')
  }

  const message = hasMessage ? replyObject.message as string : ''
  const tool_calls: ToolCall[] = []

  if (hasToolCalls) {
    for (const entry of replyObject.tool_calls as unknown[]) {
      if (isToolCallEntry(entry)) {
        tool_calls.push({ function: { name: entry.name, arguments: entry.arguments } })
      }
    }
  }

  return { message, tool_calls }
}

function tryParseReply(jsonText: string): PromptToolsReply | null {
  try {
    return parsePromptToolsReply(jsonText)
  }
  catch {
    return null
  }
}

function extractFirstJsonObject(text: string): string | null {
  let braceDepth = 0
  let objectStartIndex = -1
  let insideStringLiteral = false
  let nextCharacterIsEscaped = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]

    if (insideStringLiteral) {
      if (nextCharacterIsEscaped) {
        nextCharacterIsEscaped = false
      }
      else if (character === '\\') {
        nextCharacterIsEscaped = true
      }
      else if (character === '"') {
        insideStringLiteral = false
      }
      continue
    }

    if (character === '"') {
      insideStringLiteral = true
      continue
    }

    if (character === '{') {
      if (braceDepth === 0) {
        objectStartIndex = index
      }
      braceDepth++
    }
    else if (character === '}') {
      braceDepth--
      if (braceDepth === 0 && objectStartIndex !== -1) {
        return text.slice(objectStartIndex, index + 1)
      }
    }
  }

  return null
}

export function tryParsePromptToolsReply(modelReply: string): PromptToolsReply | null {
  const strictParse = tryParseReply(modelReply)
  if (strictParse) {
    return strictParse
  }

  const extractedObject = extractFirstJsonObject(modelReply)
  if (extractedObject) {
    const fallbackParse = tryParseReply(extractedObject)
    if (fallbackParse) {
      return fallbackParse
    }
  }

  return null
}

const REFORMAT_INSTRUCTION = 'Your previous reply was not a valid JSON object matching the required schema. Resend the SAME answer as strict JSON with fields "message" and "tool_calls". No prose, no code fences, no string concatenation — just one JSON object.'
const FALLBACK_MESSAGE = 'The model returned a malformed reply. Please try again.'

export interface PromptToolsStreamOptions {
  onStreamPart?: OnStreamPart
  signal?: AbortSignal
}

export type FormattedChat = (messages: Message[], options: PromptToolsStreamOptions) => Promise<Message>

function prependToolsInstruction(messages: Message[], instruction: string): Message[] {
  const firstMessage = messages[0]

  if (firstMessage?.role === 'system') {
    return [
      { ...firstMessage, content: `${firstMessage.content}\n\n${instruction}` },
      ...messages.slice(1),
    ]
  }

  return [{ role: 'system', content: instruction }, ...messages]
}

function filterOnlyThinkingParts(onStreamPart?: OnStreamPart): OnStreamPart | undefined {
  if (!onStreamPart) {
    return undefined
  }

  let announced = false

  return (part) => {
    if (part.thinking) {
      onStreamPart(part)
    }

    if (part.content && !announced) {
      announced = true
      process.stderr.write(gray('\nComposing reply…\n'))
    }
  }
}

function applyParsedReply(reply: Message, parsed: PromptToolsReply): Message {
  reply.content = parsed.message
  reply.tool_calls = parsed.tool_calls.length ? parsed.tool_calls : undefined
  return reply
}

export async function runPromptToolsChat(
  messages: Message[],
  tools: ToolDefinition[],
  formattedChat: FormattedChat,
  onStreamPart?: OnStreamPart,
  signal?: AbortSignal,
): Promise<Message> {
  const messagesWithInstruction = prependToolsInstruction(messages, buildToolsInstruction(tools))

  const firstReply = await formattedChat(messagesWithInstruction, {
    onStreamPart: filterOnlyThinkingParts(onStreamPart),
    signal,
  })
  const parsedFirstReply = tryParsePromptToolsReply(firstReply.content)
  if (parsedFirstReply) {
    return applyParsedReply(firstReply, parsedFirstReply)
  }

  process.stderr.write(gray('\nPrevious reply was malformed, retrying…\n'))

  const retryReply = await formattedChat(
    [...messagesWithInstruction, firstReply, { role: 'user', content: REFORMAT_INSTRUCTION }],
    { onStreamPart: filterOnlyThinkingParts(onStreamPart), signal },
  )
  const parsedRetryReply = tryParsePromptToolsReply(retryReply.content)
  if (parsedRetryReply) {
    return applyParsedReply(retryReply, parsedRetryReply)
  }

  firstReply.content = FALLBACK_MESSAGE
  firstReply.tool_calls = undefined
  return firstReply
}
