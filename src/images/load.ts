import type { Buffer } from 'node:buffer'
import type { ImageAttachment } from '../types.ts'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

const IMAGE_PATH_PATTERN = /"[^"]+\.(?:png|jpe?g|gif|webp|bmp)"|'[^']+\.(?:png|jpe?g|gif|webp|bmp)'|\S+\.(?:png|jpe?g|gif|webp|bmp)\b/gi
const WINDOWS_DRIVE_PATTERN = /^([A-Z]):[\\/]/i

function expandHome(path: string): string {
  if (path === '~') {
    return homedir()
  }
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }
  return path
}

export function translateWslPath(path: string): string {
  const match = WINDOWS_DRIVE_PATTERN.exec(path)
  if (!match) {
    return path
  }
  const drive = match[1]!.toLowerCase()
  const rest = path.slice(match[0].length).replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

function normalizePath(raw: string): string {
  const path = expandHome(translateWslPath(raw.trim()))
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

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

  let info
  try {
    info = await stat(path)
  }
  catch {
    return null
  }

  if (!info.isFile()) {
    return null
  }

  const bytes = await readFile(path)
  return { base64: bytes.toString('base64'), mimeType: detectMimeType(bytes, path) }
}

function unquote(token: string): string {
  const first = token[0]
  if ((first === '"' || first === '\'') && token.endsWith(first)) {
    return token.slice(1, -1)
  }

  return token
}

export interface ExtractResult {
  text: string
  attachments: ImageAttachment[]
}

export async function extractImagePaths(input: string): Promise<ExtractResult> {
  const matches = input.match(IMAGE_PATH_PATTERN)
  if (!matches) {
    return { text: input, attachments: [] }
  }

  const attachments: ImageAttachment[] = []
  let text = input

  for (const token of matches) {
    const attachment = await loadImageFile(unquote(token))
    if (attachment) {
      attachments.push(attachment)
      text = text.replace(token, '')
    }
  }

  return { text: text.replace(/\s{2,}/g, ' ').trim(), attachments }
}
