import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { isPlanModeActive, setPlanModeActive } from '../../plan-mode-state.ts'
import { gray, red } from '../../utils/colors.ts'

function run(context: CommandContext): CommandResult {
  const arg = context.args[0]?.toLowerCase()

  if (!arg) {
    console.warn(gray(`Plan mode is ${isPlanModeActive() ? 'on' : 'off'}. Use /plan-mode on|off to change it.`))
    return { kind: 'continue' }
  }

  if (arg === 'on' || arg === 'off') {
    setPlanModeActive(arg === 'on')
    console.warn(gray(`Plan mode is now ${arg}.`))
    return { kind: 'continue' }
  }

  console.warn(red('Usage: /plan-mode [on|off].'))
  return { kind: 'continue' }
}

export const planModeCommand: SlashCommand = {
  name: 'plan-mode',
  description: 'Toggle plan mode: /plan-mode [on|off].',
  run,
}
