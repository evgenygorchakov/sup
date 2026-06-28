import type { ImageAttachment } from '../types.ts'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { loadImageFile } from './load.ts'

const POWERSHELL_IMAGE_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
  '$img = [System.Windows.Forms.Clipboard]::GetImage();',
  'if ($img) {',
  '  $ms = New-Object System.IO.MemoryStream;',
  '  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);',
  '  [Convert]::ToBase64String($ms.ToArray())',
  '}',
].join(' ')

const POWERSHELL_FILES_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$files = [System.Windows.Forms.Clipboard]::GetFileDropList();',
  'if ($files) { $files | ForEach-Object { $_ } }',
].join(' ')

const MACOS_FILE_SCRIPT = 'POSIX path of (the clipboard as «class furl»)'

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

async function captureText(command: string, args: string[]): Promise<string | null> {
  const out = await capture(command, args)
  return out ? out.toString('utf8') : null
}

function mimeFromBytes(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }
  return 'image/png'
}

function fromRawBytes(bytes: Buffer | null): ImageAttachment | null {
  if (!bytes || bytes.length === 0) {
    return null
  }
  return { base64: bytes.toString('base64'), mimeType: mimeFromBytes(bytes) }
}

async function readClipboardBitmap(): Promise<ImageAttachment | null> {
  if (isWsl()) {
    const out = await capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_IMAGE_SCRIPT])
    const base64 = out?.toString('utf8').trim()
    return base64 ? { base64, mimeType: 'image/png' } : null
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

async function readClipboardFilePaths(): Promise<string | null> {
  if (isWsl()) {
    return captureText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_FILES_SCRIPT])
  }

  if (process.platform === 'darwin') {
    return captureText('osascript', ['-e', 'try', '-e', MACOS_FILE_SCRIPT, '-e', 'end try'])
  }

  if (process.env.WAYLAND_DISPLAY) {
    return captureText('wl-paste', ['--type', 'text/uri-list'])
  }

  if (process.env.DISPLAY) {
    return captureText('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list', '-o'])
  }

  return null
}

async function readClipboardFileImage(): Promise<ImageAttachment | null> {
  const raw = await readClipboardFilePaths()
  if (!raw) {
    return null
  }

  for (const line of raw.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean)) {
    const attachment = await loadImageFile(line)
    if (attachment) {
      return attachment
    }
  }

  return null
}

export async function readClipboardImage(): Promise<ImageAttachment | null> {
  return (await readClipboardBitmap()) ?? readClipboardFileImage()
}
