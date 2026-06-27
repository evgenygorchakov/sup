// Lets the user interrupt an in-flight model request by pressing Esc.
//
// While `fn` runs we listen to raw stdin in parallel with the existing pipe
// (data events fan out to every listener, so readline is unaffected) and abort
// the request's AbortController on a lone Esc. We don't touch the terminal mode.

import type { Buffer } from 'node:buffer'
import { stdin } from 'node:process'
import { getInputStream } from './multiline-input.ts'

const ESC = 0x1B

// A bare Esc arrives as a single 0x1B byte; escape sequences (arrows, paste
// markers) are longer, so length === 1 distinguishes a real Esc keypress.
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
      // The Esc byte sits buffered in the paste transform (it waits to see if a
      // paste sequence follows); drop it so it doesn't eat the first keystroke
      // of the next prompt.
      if (controller.signal.aborted) {
        getInputStream().resetPending()
      }
    }
  }
}
