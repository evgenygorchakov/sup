import type { Message, ToolCall } from '../types.ts'
import { persistImages } from './images.ts'
import { appendEvent, ensureRun } from './store.ts'

export function startRun(messages: Message[]): void {
  ensureRun()
  const opening = messages[messages.length - 1]
  if (opening?.role === 'user') {
    recordUserMessage(opening)
  }
}

export function recordUserMessage(message: Message): void {
  const imageRefs = message.images?.length ? persistImages(message.images) : null
  appendEvent('user', { message: { ...message, images: undefined }, images: imageRefs ?? undefined })
}

export function recordAssistant(reply: Message): void {
  appendEvent('assistant', { message: reply })
}

export function recordToolCall(call: ToolCall): void {
  appendEvent('tool_call', { name: call.function.name, arguments: call.function.arguments, id: call.id })
}

export function recordToolResult(call: ToolCall, result: string): void {
  appendEvent('tool_result', {
    name: call.function.name,
    message: { role: 'tool', content: result, tool_call_id: call.id },
  })
}

export function recordFinish(): void {
  appendEvent('finish')
}

export function recordClear(): void {
  appendEvent('clear')
}
