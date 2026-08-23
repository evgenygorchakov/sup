import type { Message, ToolDefinition } from '../../types.ts'
import type { OnStreamPart } from '../../ui/interactive/stream-printer.ts'
import type { ChatProvider } from '../types.ts'

import { Config } from '../../config.ts'
import { chat as rawChat } from './chat.ts'
import { getContextWindowTokenLimit, initializeContextWindow } from './context-window.ts'
import { listInstalledModels, resolveDefaultModel } from './models.ts'

async function chat(messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart, signal?: AbortSignal): Promise<Message> {
  return await rawChat(messages, { tools: tools.length ? tools : undefined, onStreamPart, signal })
}

export const llamacpp: ChatProvider = { host: Config.LLAMACPP_HOST, chat, initializeContextWindow, getContextWindowTokenLimit, listInstalledModels, resolveDefaultModel }
