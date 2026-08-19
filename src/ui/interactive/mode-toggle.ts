import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { cycleMode } from '../../plan/mode-state.ts'

export function installModeToggle(
  inputStream: EventEmitter,
  readline: ReadlineInterface,
  buildPrompt: () => string,
): { setActive: (value: boolean) => void } {
  let active = false

  inputStream.on('shift-tab', () => {
    if (!active) {
      return
    }

    cycleMode()
    readline.setPrompt(buildPrompt())
    readline.prompt(true)
  })

  return {
    setActive(value) {
      active = value
    },
  }
}
