import type { Message, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/stream-printer.ts'
import type { ChatProvider } from '../types.ts'

import process from 'node:process'
import { Config } from '../../config.ts'
import { gray } from '../../utils/colors.ts'
import { chat as rawChat } from './chat.ts'
import { buildReplyFormat, buildToolsInstruction, tryParsePromptToolsReply } from './prompt-tools.ts'

const REFORMAT_INSTRUCTION = 'Your previous reply was not a valid JSON object matching the required schema. Resend the SAME answer as strict JSON with fields "message" and "tool_calls". No prose, no code fences, no string concatenation — just one JSON object.'
const FALLBACK_MESSAGE = 'The model returned a malformed reply. Please try again.'

const nativeToolsEnabled = Config.USE_NATIVE_OLLAMA_TOOLS

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

async function chat(messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart): Promise<Message> {
  if (!tools.length) {
    return await rawChat(messages, { onStreamPart })
  }

  if (nativeToolsEnabled) {
    return await rawChat(messages, { tools, onStreamPart })
  }

  const messagesWithInstruction = prependToolsInstruction(messages, buildToolsInstruction(tools))
  const replySchema = buildReplyFormat(tools)

  const firstReply = await rawChat(messagesWithInstruction, {
    format: replySchema,
    onStreamPart: filterOnlyThinkingParts(onStreamPart),
  })
  const parsedFirstReply = tryParsePromptToolsReply(firstReply.content)

  if (parsedFirstReply) {
    firstReply.content = parsedFirstReply.message
    firstReply.tool_calls = parsedFirstReply.tool_calls.length ? parsedFirstReply.tool_calls : undefined
    return firstReply
  }

  process.stderr.write(gray('\nPrevious reply was malformed, retrying…\n'))

  const retryReply = await rawChat(
    [...messagesWithInstruction, firstReply, { role: 'user', content: REFORMAT_INSTRUCTION }],
    { format: replySchema, onStreamPart: filterOnlyThinkingParts(onStreamPart) },
  )
  const parsedRetryReply = tryParsePromptToolsReply(retryReply.content)

  if (parsedRetryReply) {
    retryReply.content = parsedRetryReply.message
    retryReply.tool_calls = parsedRetryReply.tool_calls.length ? parsedRetryReply.tool_calls : undefined
    return retryReply
  }

  firstReply.content = FALLBACK_MESSAGE
  firstReply.tool_calls = undefined
  return firstReply
}

export const ollama: ChatProvider = { chat }
