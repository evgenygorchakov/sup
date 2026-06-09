import type { SelectChoice } from '../../ui/interactive/select.ts'
import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { stdin } from 'node:process'
import { isPlanModeActive, setPlanModeActive } from '../../plan/mode-state.ts'
import { selectFromList } from '../../ui/interactive/select.ts'
import { gray, red } from '../../utils/colors.ts'

interface PlanModeChoice extends SelectChoice {
  enabled: boolean
}

const PLAN_MODE_CHOICES: PlanModeChoice[] = [
  { label: 'on', enabled: true },
  { label: 'off', enabled: false },
]

function setPlanMode(enabled: boolean): void {
  setPlanModeActive(enabled)
  console.warn(gray(`Plan mode is now ${enabled ? 'on' : 'off'}.`))
}

export async function changePlanModeInteractive(): Promise<void> {
  const currentIndex = PLAN_MODE_CHOICES.findIndex(choice => choice.enabled === isPlanModeActive())
  const selectedIndex = await selectFromList('Plan mode', PLAN_MODE_CHOICES, currentIndex)
  if (selectedIndex === null) {
    return
  }

  setPlanMode(PLAN_MODE_CHOICES[selectedIndex].enabled)
}

async function run(context: CommandContext): Promise<CommandResult> {
  const arg = context.args[0]?.toLowerCase()

  if (!arg) {
    if (stdin.isTTY) {
      await changePlanModeInteractive()
      return { kind: 'continue' }
    }

    console.warn(gray(`Plan mode is ${isPlanModeActive() ? 'on' : 'off'}. Use /plan-mode on|off to change it.`))
    return { kind: 'continue' }
  }

  if (arg === 'on' || arg === 'off') {
    setPlanMode(arg === 'on')
    return { kind: 'continue' }
  }

  console.warn(red('Usage: /plan-mode [on|off].'))
  return { kind: 'continue' }
}

export const planModeCommand: SlashCommand = {
  name: 'plan-mode',
  description: 'Toggle plan mode: /plan-mode opens a menu, or /plan-mode [on|off].',
  run,
}
