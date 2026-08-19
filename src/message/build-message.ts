import type { ImageAttachment, Message } from '../types.ts'
import { expandClipboardMarkers } from '../clipboard/pending.ts'
import { Config } from '../config.ts'
import { convertDroppedPdfs } from '../documents/pdf.ts'
import { extractImagePaths } from '../images/load.ts'
import { takePendingImages } from '../images/pending.ts'

/** Null when the input was nothing but PDFs: the markdown files are the whole result of that turn. */
export async function buildUserMessage(input: string): Promise<Message | null> {
  const pasted = takePendingImages()
  const { text: withoutImages, attachments } = await extractImagePaths(input)
  const { text, converted } = Config.USE_PDF_CONVERT
    ? await convertDroppedPdfs(withoutImages)
    : { text: withoutImages, converted: 0 }

  const images: ImageAttachment[] = [...pasted, ...attachments]
  const stripped = images.length > 0 || converted > 0 ? text : input
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
