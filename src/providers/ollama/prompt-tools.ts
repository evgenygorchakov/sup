import type { ToolCall, ToolDefinition } from '../../types.ts'

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

// Find the first balanced {...} block, respecting "..." string literals.
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
