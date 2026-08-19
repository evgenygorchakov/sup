import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const clipboardCommand = createToggleCommand({
  name: 'clipboard',
  description: 'Toggle attaching clipboard text to what you dictate: /clipboard opens a menu, or /clipboard [on|off].',
  get: () => Config.USE_DICTATION_CLIPBOARD,
  set: (value) => {
    Config.USE_DICTATION_CLIPBOARD = value
  },
})
