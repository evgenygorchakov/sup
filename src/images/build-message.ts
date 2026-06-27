import type { ImageAttachment, Message } from '../types.ts'
import { extractImagePaths } from './load.ts'
import { takePendingImages } from './pending.ts'

export async function buildUserMessage(input: string): Promise<Message> {
  const pasted = takePendingImages()
  const { text, attachments } = await extractImagePaths(input)
  const images: ImageAttachment[] = [...pasted, ...attachments]
  const message: Message = { role: 'user', content: images.length > 0 ? text : input }
  if (images.length > 0) {
    message.images = images
  }

  return message
}
