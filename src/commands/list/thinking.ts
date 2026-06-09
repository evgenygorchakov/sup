import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const thinkingCommand = createToggleCommand({
  name: 'thinking',
  description: 'Toggle model thinking: /thinking opens a menu, or /thinking [on|off].',
  get: () => Config.USE_THINKING,
  set: (value) => { Config.USE_THINKING = value },
})
