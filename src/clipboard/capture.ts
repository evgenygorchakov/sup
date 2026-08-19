import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const CAPTURE_TIMEOUT_MS = 10_000

let cachedIsWsl: boolean | null = null

export function isWsl(): boolean {
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

export function capture(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: CAPTURE_TIMEOUT_MS })
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

export async function captureText(command: string, args: string[]): Promise<string | null> {
  const out = await capture(command, args)
  return out ? out.toString('utf8') : null
}
