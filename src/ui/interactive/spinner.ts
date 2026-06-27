// A throbber for the dead time before the model's first token.
//
// A local model is silent while it loads, prefills the prompt and compiles the
// tool grammar — that gap can run into minutes (see REQUEST_FIRST_TOKEN_TIMEOUT_MS).
// This animates in stderr to show the request is alive, then erases itself the
// moment real output starts, so it never collides with streamed text.

import process from 'node:process'
import { gray } from '../../utils/colors.ts'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_INTERVAL_MS = 80

export interface Spinner {
  /** Stop animating and wipe the line. Idempotent. */
  stop: () => void
}

export function startSpinner(label: string): Spinner {
  // Only animate on an interactive terminal; piped/redirected stderr should stay
  // free of control characters.
  if (!process.stderr.isTTY) {
    return { stop: () => {} }
  }

  let frame = 0
  let stopped = false
  const startedAt = Date.now()

  const render = (): void => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    const suffix = elapsed > 0 ? ` ${elapsed}s` : ''
    // \r returns to column 0, \x1B[K clears to end of line (covers a shorter
    // frame than the previous one, e.g. when the seconds counter narrows).
    process.stderr.write(`\r${gray(`${FRAMES[frame]} ${label}${suffix}`)}\x1B[K`)
    frame = (frame + 1) % FRAMES.length
  }

  render()
  const timer = setInterval(render, FRAME_INTERVAL_MS)

  return {
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      clearInterval(timer)
      process.stderr.write('\r\x1B[K')
    },
  }
}
