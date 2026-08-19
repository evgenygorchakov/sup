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
})
