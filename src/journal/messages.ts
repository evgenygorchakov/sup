import type { Message } from '../types.ts'
import type { ImageRef } from './images.ts'
import type { JournalEvent } from './store.ts'
import { loadImages } from './images.ts'

export function reconstructMessages(events: JournalEvent[], runId: string): Message[] {
  const messages: Message[] = []
  for (const event of events) {
    if (event.type === 'clear') {
      messages.length = 0
      continue
    }
    if ((event.type === 'user' || event.type === 'assistant' || event.type === 'tool_result') && event.message) {
      const message = event.message as Message
      if (event.type === 'user' && Array.isArray(event.images) && event.images.length > 0) {
        const images = loadImages(runId, event.images as ImageRef[])
        if (images.length > 0) {
          message.images = images
        }
      }
      messages.push(message)
    }
  }
  return messages
}
