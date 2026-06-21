import type { Message, ToolDefinition } from '../types.ts'
import type { OnStreamPart } from '../ui/interactive/stream-printer.ts'

export type ModelListResult
  = | { ok: true, models: string[] }
    | { ok: false, error: string }

export interface ChatProvider {
  chat: (messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart) => Promise<Message>
  initializeContextWindow: () => Promise<void>
  getContextWindowTokenLimit: () => number
  listInstalledModels: () => Promise<ModelListResult>
}
