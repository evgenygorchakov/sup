// Reading an image out of the OS clipboard. Terminals don't deliver image
// bytes over stdin, so a Ctrl+V "paste" has to shell out to a platform tool:
//   - WSL2:    powershell.exe (bridge to the Windows clipboard) -> base64 PNG
//   - macOS:   pngpaste -> raw PNG bytes
//   - Wayland: wl-paste --type image/png
//   - X11:     xclip -selection clipboard -t image/png -o
// Any failure (no tool, no image) resolves to null; the caller stays quiet-ish.

import type { ImageAttachment } from '../types.ts'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const POWERSHELL_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
  '$img = [System.Windows.Forms.Clipboard]::GetImage();',
  'if ($img) {',
  '  $ms = New-Object System.IO.MemoryStream;',
  '  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);',
  '  [Convert]::ToBase64String($ms.ToArray())',
  '}',
].join(' ')

let cachedIsWsl: boolean | null = null

function isWsl(): boolean {
  if (cachedIsWsl !== null) {
    return cachedIsWsl
  }
  if (process.platform !== 'linux') {
    cachedIsWsl = false
    return cachedIsWsl
  }
  try {
    cachedIsWsl = /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  }
  catch {
    cachedIsWsl = false
  }
  return cachedIsWsl
}

function capture(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    }
    catch {
      resolvePromise(null)
      return
    }

    const chunks: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', () => resolvePromise(null))
    child.on('close', (code) => {
      resolvePromise(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null)
    })
  })
}

function mimeFromBytes(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }
  return 'image/png'
}

// Returns the captured image, or a non-empty buffer that wasn't an image at all
// (e.g. an empty/whitespace clipboard text) is treated as "no image" -> null.
function fromRawBytes(bytes: Buffer | null): ImageAttachment | null {
  if (!bytes || bytes.length === 0) {
    return null
  }
  return { data: bytes.toString('base64'), mimeType: mimeFromBytes(bytes) }
}

export async function readClipboardImage(): Promise<ImageAttachment | null> {
  if (isWsl()) {
    const out = await capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SCRIPT])
    const base64 = out?.toString('utf8').trim()
    return base64 ? { data: base64, mimeType: 'image/png' } : null
  }

  if (process.platform === 'darwin') {
    return fromRawBytes(await capture('pngpaste', ['-']))
  }

  if (process.env.WAYLAND_DISPLAY) {
    return fromRawBytes(await capture('wl-paste', ['--type', 'image/png']))
  }

  if (process.env.DISPLAY) {
    return fromRawBytes(await capture('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']))
  }

  return null
}
