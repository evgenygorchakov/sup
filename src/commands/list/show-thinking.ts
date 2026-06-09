import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const showThinkingCommand = createToggleCommand({
  name: 'show-thinking',
  description: 'Toggle streaming of the thinking text: /show-thinking opens a menu, or /show-thinking [on|off].',
  get: () => Config.SHOW_THINKING,
  set: (value) => { Config.SHOW_THINKING = value },
})
