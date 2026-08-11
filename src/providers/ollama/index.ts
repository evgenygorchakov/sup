import type { Message, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import type { ChatProvider } from '../types.ts'

import { Config } from '../../config.ts'
import { buildReplyFormat, runPromptToolsChat } from '../prompt-tools.ts'
import { chat as rawChat } from './chat.ts'
import { getContextWindowTokenLimit, initializeContextWindow } from './context-window.ts'
import { listInstalledModels, resolveDefaultModel } from './models.ts'

async function chat(messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart, signal?: AbortSignal): Promise<Message> {
  if (!tools.length) {
    return await rawChat(messages, { onStreamPart, signal })
  }

  if (Config.USE_NATIVE_TOOLS) {
    return await rawChat(messages, { tools, onStreamPart, signal })
  }

  const format = buildReplyFormat(tools)
  return await runPromptToolsChat(
    messages,
    tools,
    (formattedMessages, options) => rawChat(formattedMessages, { format, ...options }),
    onStreamPart,
    signal,
  )
}

export const ollama: ChatProvider = { host: Config.OLLAMA_HOST, chat, initializeContextWindow, getContextWindowTokenLimit, listInstalledModels, resolveDefaultModel }
