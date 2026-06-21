// Assembling a user message from raw input. Image attachments come from two
// places and merge here: paths typed/dropped into the line (extractImagePaths)
// and clipboard pastes accumulated during typing (takePendingImages).

import type { ImageAttachment, Message } from '../types.ts'
import { Config } from '../config.ts'
import { extractImagePaths } from './load.ts'
import { takePendingImages } from './pending.ts'

export async function buildUserMessage(input: string): Promise<Message> {
  if (!Config.USE_IMAGE_INPUT) {
    return { role: 'user', content: input }
  }

  const pasted = takePendingImages()
  const { text, attachments } = await extractImagePaths(input)
  const images: ImageAttachment[] = [...pasted, ...attachments]

  // When the line was nothing but an image path, content is left empty on
  // purpose — the attachment carries the turn.
  const message: Message = { role: 'user', content: images.length > 0 ? text : input }
  if (images.length > 0) {
    message.images = images
  }
  return message
}
