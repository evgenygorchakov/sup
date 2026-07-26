import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const sttCommand = createToggleCommand({
  name: 'stt',
  description: 'Toggle Ctrl+G dictation: /stt opens a menu, or /stt [on|off].',
  get: () => Config.USE_STT,
  set: (value) => {
    Config.USE_STT = value
  },
})
