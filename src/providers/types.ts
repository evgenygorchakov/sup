import type { Message, ToolDefinition } from '../types.ts'
import type { OnStreamPart } from '../ui/interactive/stream-printer.ts'

export type ModelListResult
  = | { ok: true, models: string[] }
    | { ok: false, error: string }

export interface ChatProvider {
  host: string
  chat: (messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart, signal?: AbortSignal) => Promise<Message>
  initializeContextWindow: () => Promise<void>
  getContextWindowTokenLimit: () => number
  listInstalledModels: () => Promise<ModelListResult>
  /** Model to use when MODEL is not configured; null when the server cannot be asked. */
  resolveDefaultModel: () => Promise<string | null>
  /** Startup check of a configured MODEL; returns why it cannot serve requests, or null when it can.
   *  Absent on providers that ignore MODEL. */
  checkConfiguredModel?: () => Promise<string | null>
}
