// A tiny module-level holding area for images pasted with Ctrl+V while the user
// is still typing a line. The keypress handler adds them here; buildUserMessage
// drains them when the line is submitted, so they ride along with that turn.

import type { ImageAttachment } from '../types.ts'

const pending: ImageAttachment[] = []

export function addPendingImage(image: ImageAttachment): number {
  pending.push(image)
  return pending.length
}

export function takePendingImages(): ImageAttachment[] {
  return pending.splice(0, pending.length)
}
