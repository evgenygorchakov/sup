import type { ImageAttachment, Message } from '../types.ts'
import { expandClipboardMarkers } from '../clipboard/pending.ts'
import { extractImagePaths } from '../images/load.ts'
import { takePendingImages } from '../images/pending.ts'

export async function buildUserMessage(input: string): Promise<Message | null> {
  const pasted = takePendingImages()
  const { text, attachments } = await extractImagePaths(input)

  const images: ImageAttachment[] = [...pasted, ...attachments]
  const stripped = images.length > 0 ? text : input
  const content = expandClipboardMarkers(stripped)

  if (!content && images.length === 0) {
    return null
  }

  const message: Message = { role: 'user', content }
  if (images.length > 0) {
    message.images = images
  }

  return message
}
