import type { Message, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import type { ChatProvider } from '../types.ts'

import { Config } from '../../config.ts'
import { chat as rawChat } from './chat.ts'
import { getContextWindowTokenLimit, initializeContextWindow, refreshContextWindow } from './context-window.ts'
import { checkConfiguredModel, listInstalledModels, resolveDefaultModel } from './models.ts'

async function chat(messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart, signal?: AbortSignal): Promise<Message> {
  const reply = await rawChat(messages, { tools: tools.length ? tools : undefined, onStreamPart, signal })
  await refreshContextWindow()
  return reply
}

export const ollama: ChatProvider = { host: Config.OLLAMA_HOST, chat, initializeContextWindow, getContextWindowTokenLimit, listInstalledModels, resolveDefaultModel, checkConfiguredModel }
