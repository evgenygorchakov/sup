import type { ImageAttachment } from '../types.ts'
import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activeRunDirectory, journalEnabled, runsDirectory } from './store.ts'

const IMAGES_SUBDIR = 'images'

export interface ImageRef {
  file: string
  mimeType: string
}

let imageSequence = 0

function mimeToExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    default: return 'png'
  }
}

export function persistImages(images: ImageAttachment[]): ImageRef[] | null {
  const runDir = activeRunDirectory()
  if (!journalEnabled() || !runDir || images.length === 0) {
    return null
  }

  const dir = join(runDir, IMAGES_SUBDIR)
  try {
    mkdirSync(dir, { recursive: true })
  }
  catch {
    return null
  }

  const refs: ImageRef[] = []
  for (const image of images) {
    const file = `${Date.now()}-${imageSequence++}.${mimeToExtension(image.mimeType)}`
    try {
      writeFileSync(join(dir, file), Buffer.from(image.base64, 'base64'))
      refs.push({ file, mimeType: image.mimeType })
    }
    catch {}
  }
  return refs.length > 0 ? refs : null
}

export function loadImages(runId: string, refs: ImageRef[]): ImageAttachment[] {
  const dir = join(runsDirectory(), runId, IMAGES_SUBDIR)
  const images: ImageAttachment[] = []
  for (const ref of refs) {
    try {
      const bytes = readFileSync(join(dir, ref.file))
      images.push({ base64: bytes.toString('base64'), mimeType: ref.mimeType })
    }
    catch {}
  }
  return images
}
