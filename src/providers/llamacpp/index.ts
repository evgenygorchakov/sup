import type { Message, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import type { ChatProvider } from '../types.ts'

import { Config } from '../../config.ts'
import { buildReplyFormat, runPromptToolsChat } from '../prompt-tools.ts'
import { chat as rawChat } from './chat.ts'
import { getContextWindowTokenLimit, initializeContextWindow } from './context-window.ts'
import { listInstalledModels } from './models.ts'

const nativeToolsEnabled = Config.USE_NATIVE_TOOLS

function toResponseFormat(tools: ToolDefinition[]): object {
  return {
    type: 'json_schema',
    json_schema: { name: 'tool_reply', strict: true, schema: buildReplyFormat(tools) },
  }
}

async function chat(messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart, signal?: AbortSignal): Promise<Message> {
  if (!tools.length) {
    return await rawChat(messages, { onStreamPart, signal })
  }

  if (nativeToolsEnabled) {
    return await rawChat(messages, { tools, onStreamPart, signal })
  }

  const responseFormat = toResponseFormat(tools)
  return await runPromptToolsChat(
    messages,
    tools,
    (formattedMessages, options) => rawChat(formattedMessages, { responseFormat, ...options }),
    onStreamPart,
    signal,
  )
}

export const llamacpp: ChatProvider = { host: Config.LLAMACPP_HOST, chat, initializeContextWindow, getContextWindowTokenLimit, listInstalledModels }
