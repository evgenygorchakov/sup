import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { Config } from '../../config.ts'
import { isPlanModeActive, setPlanModeActive } from '../../plan/mode-state.ts'

// readline can redraw the current line (prompt + buffer) in place, but only via
// this internal method — there is no public equivalent.
interface RefreshableReadline {
  setPrompt: (prompt: string) => void
  _refreshLine: () => void
}

// Shift+Tab toggles plan mode while the user is at the prompt, refreshing the
// prompt so the `[plan]` indicator updates immediately. `buildPrompt` must
// return the same string the read loop renders, so the line stays consistent.
export function installPlanModeToggle(
  inputStream: EventEmitter,
  readline: ReadlineInterface,
  buildPrompt: () => string,
): { setActive: (value: boolean) => void } {
  let active = false

  inputStream.on('shift-tab', () => {
    // Read-only mode forbids plan mode: an approved plan could never be run.
    if (!active || Config.USE_READ_ONLY_MODE) {
      return
    }

    setPlanModeActive(!isPlanModeActive())
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
