import type { Buffer } from 'node:buffer'
import { stdin } from 'node:process'
import { getInputStream } from './multiline-input.ts'

const ESC = 0x1B

function isEscKey(chunk: Buffer): boolean {
  return chunk.length === 1 && chunk[0] === ESC
}

export async function withRequestInterrupt<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const interactive = Boolean(stdin.isTTY)

  const onData = (chunk: Buffer): void => {
    if (isEscKey(chunk)) {
      controller.abort()
    }
  }

  if (interactive) {
    stdin.on('data', onData)
  }

  try {
    return await fn(controller.signal)
  }
  finally {
    if (interactive) {
      stdin.removeListener('data', onData)
      if (controller.signal.aborted) {
        getInputStream().resetPending()
      }
    }
  }
}
