import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const verboseCommand = createToggleCommand({
  name: 'verbose',
  description: 'Toggle full, untruncated tool output: /verbose opens a menu, or /verbose [on|off].',
  get: () => Config.VERBOSE_TOOL_OUTPUT,
  set: (value) => { Config.VERBOSE_TOOL_OUTPUT = value },
})
