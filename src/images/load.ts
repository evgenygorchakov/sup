import type { Buffer } from 'node:buffer'
import type { ImageAttachment } from '../types.ts'
import { readFile, stat } from 'node:fs/promises'
import { normalizePath, removeTokenWithSurroundingSpaces, stripFileUri, unquote } from '../files/paths.ts'

const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp)$/i
const INLINE_IMAGE_PATH_PATTERN = /"[^"]+\.(?:png|jpe?g|gif|webp|bmp)"|'[^']+\.(?:png|jpe?g|gif|webp|bmp)'|\S+\.(?:png|jpe?g|gif|webp|bmp)\b/gi

function detectMimeType(bytes: Buffer, path: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif'
  }

  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
    return 'image/bmp'
  }

  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
}

export async function loadImageFile(rawPath: string): Promise<ImageAttachment | null> {
  const path = normalizePath(rawPath)

  let bytes
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return null
    }
    bytes = await readFile(path)
  }
  catch {
    return null
  }

  return { base64: bytes.toString('base64'), mimeType: detectMimeType(bytes, path) }
}

export function looksLikeImagePath(token: string): boolean {
  return IMAGE_EXTENSION_PATTERN.test(stripFileUri(unquote(token.trim())))
}

export interface ExtractResult {
  text: string
  attachments: ImageAttachment[]
}

async function extractFromImageLines(input: string): Promise<ExtractResult | null> {
  const lines = input.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0 || !lines.every(looksLikeImagePath)) {
    return null
  }

  const attachments: ImageAttachment[] = []
  for (const line of lines) {
    const attachment = await loadImageFile(unquote(line))
    if (attachment) {
      attachments.push(attachment)
    }
  }

  return attachments.length === lines.length ? { text: '', attachments } : null
}

async function extractInlinePaths(input: string): Promise<ExtractResult> {
  const matches = input.match(INLINE_IMAGE_PATH_PATTERN)
  if (!matches) {
    return { text: input, attachments: [] }
  }

  const attachments: ImageAttachment[] = []
  let text = input

  for (const token of matches) {
    const attachment = await loadImageFile(unquote(token))
    if (attachment) {
      attachments.push(attachment)
      text = removeTokenWithSurroundingSpaces(text, token)
    }
  }

  return { text: text.trim(), attachments }
}

export async function extractImagePaths(input: string): Promise<ExtractResult> {
  const fromLines = await extractFromImageLines(input)
  return fromLines ?? extractInlinePaths(input)
}
