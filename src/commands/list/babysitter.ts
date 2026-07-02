import { ledgerToolRegistered } from '../../babysitter/ledger-tool.ts'
import { Config } from '../../config.ts'
import { yellow } from '../../utils/colors.ts'
import { createToggleCommand } from '../toggle.ts'

export const babysitterCommand = createToggleCommand({
  name: 'babysitter',
  description: 'Toggle babysitter mode (gate, journal, ledger, gated skills): /babysitter opens a menu, or /babysitter [on|off].',
  get: () => Config.USE_BABYSITTER,
  set: (value) => {
    Config.USE_BABYSITTER = value
    if (value && Config.BABYSITTER_LEDGER && !ledgerToolRegistered) {
      console.warn(yellow('The step ledger stays off for this session: the ledger_update tool is added to the toolset only at startup. Restart with USE_BABYSITTER=true to enable it. The verification gate and journal are active now.'))
    }
  },
})
