import process from 'node:process'
import { gray } from '../../utils/colors.ts'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_INTERVAL_MS = 80

export interface Spinner {
  stop: () => void
}

export function startSpinner(label: string): Spinner {
  if (!process.stderr.isTTY) {
    return { stop: () => {} }
  }

  let frame = 0
  let stopped = false
  const startedAt = Date.now()

  const render = (): void => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000)
    const suffix = elapsed > 0 ? ` ${elapsed}s` : ''
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
