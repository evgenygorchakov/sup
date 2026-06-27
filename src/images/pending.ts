import type { ImageAttachment } from '../types.ts'

const pending: ImageAttachment[] = []

export function addPendingImage(image: ImageAttachment): number {
  pending.push(image)
  return pending.length
}

export function takePendingImages(): ImageAttachment[] {
  return pending.splice(0, pending.length)
}
