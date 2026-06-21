import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const babysitterCommand = createToggleCommand({
  name: 'babysitter',
  description: 'Toggle babysitter mode (gate, journal, ledger, gated skills): /babysitter opens a menu, or /babysitter [on|off].',
  get: () => Config.USE_BABYSITTER,
  set: (value) => { Config.USE_BABYSITTER = value },
})
