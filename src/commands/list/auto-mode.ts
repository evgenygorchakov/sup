import { Config } from '../../config.ts'
import { isAutoModeActive, setMode } from '../../plan/mode-state.ts'
import { createToggleCommand } from '../toggle.ts'

export const autoModeCommand = createToggleCommand({
  name: 'auto-mode',
  description: 'Toggle auto mode (auto-approve edits): /auto-mode opens a menu, or /auto-mode [on|off].',
  get: () => isAutoModeActive(),
  set: (enabled) => {
    if (enabled) {
      setMode('auto')
    }
    else if (isAutoModeActive()) {
      setMode('normal')
    }
  },
  unavailableReason: () => Config.USE_READ_ONLY_MODE
    ? 'Auto mode is unavailable in read-only mode: there are no mutating tools to auto-approve.'
    : undefined,
})
