import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { Config } from '../../config.ts'
import { cycleMode } from '../../plan/mode-state.ts'

interface RefreshableReadline {
  setPrompt: (prompt: string) => void
  _refreshLine: () => void
}

export function installModeToggle(
  inputStream: EventEmitter,
  readline: ReadlineInterface,
  buildPrompt: () => string,
): { setActive: (value: boolean) => void } {
  let active = false

  inputStream.on('shift-tab', () => {
    if (!active || Config.USE_READ_ONLY_MODE) {
      return
    }

    cycleMode()
    const refreshable = readline as unknown as RefreshableReadline
    refreshable.setPrompt(buildPrompt())
    refreshable._refreshLine()
  })

  return {
    setActive(value) {
      active = value
    },
  }
}
