import process from 'node:process'
import { captureText, isWsl } from './capture.ts'

const POWERSHELL_TEXT_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
  'Get-Clipboard -Raw',
].join(' ')

const URL_PATTERN = /^https?:\/\/\S+$/i
const BARE_HOST_PATTERN = /^www\.[^\s/]+\.\S+$/i

async function readRaw(): Promise<string | null> {
  if (isWsl()) {
    return captureText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_TEXT_SCRIPT])
  }

  if (process.platform === 'darwin') {
    return captureText('pbpaste', [])
  }

  if (process.env.WAYLAND_DISPLAY) {
    return captureText('wl-paste', ['--no-newline', '--type', 'text/plain'])
  }

  if (process.env.DISPLAY) {
    return captureText('xclip', ['-selection', 'clipboard', '-o'])
  }

  return null
}

/** Plain text sitting in the clipboard, normalized to \n and trimmed. Null when there is none. */
export async function readClipboardText(): Promise<string | null> {
  const raw = await readRaw()
  if (!raw) {
    return null
  }

  const text = raw.replace(/\r\n|\r/g, '\n').trim()
  return text || null
}

/** A lone link — nothing else on the line — optionally without its scheme. Returns it with a scheme, or null. */
export function asUrl(text: string): string | null {
  if (URL_PATTERN.test(text)) {
    return text
  }
  return BARE_HOST_PATTERN.test(text) ? `https://${text}` : null
}
