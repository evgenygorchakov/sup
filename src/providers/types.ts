import type { Message, ToolDefinition } from '../types.ts'
import type { OnStreamPart } from '../ui/stream-printer.ts'

export interface ChatProvider {
  chat: (messages: Message[], tools: ToolDefinition[], onStreamPart?: OnStreamPart) => Promise<Message>
}
