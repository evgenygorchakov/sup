import type { SelectChoice } from '../ui/interactive/select.ts'
import type { CommandContext, CommandResult, SlashCommand } from './types.ts'
import { stdin } from 'node:process'
import { selectFromList } from '../ui/interactive/select.ts'
import { gray, red } from '../utils/colors.ts'

interface ToggleOptions {
  name: string
  description: string
  get: () => boolean
  set: (value: boolean) => void
  unavailableReason?: () => string | undefined
}

const STATE_CHOICES: SelectChoice[] = [{ label: 'on' }, { label: 'off' }]

export function createToggleCommand(options: ToggleOptions): SlashCommand {
  const { name, description, get, set, unavailableReason } = options

  function apply(enabled: boolean): void {
    set(enabled)
    console.warn(gray(`${name} is now ${enabled ? 'on' : 'off'}.`))
  }

  async function chooseInteractively(): Promise<void> {
    const selectedIndex = await selectFromList(name, STATE_CHOICES, get() ? 0 : 1)
    if (selectedIndex === null) {
      return
    }

    apply(selectedIndex === 0)
  }

  async function run(context: CommandContext): Promise<CommandResult> {
    const reason = unavailableReason?.()
    if (reason) {
      console.warn(gray(reason))
      return { kind: 'continue' }
    }

    const arg = context.args[0]?.toLowerCase()

    if (!arg) {
      if (stdin.isTTY) {
        await chooseInteractively()
      }
      else {
        console.warn(gray(`${name} is ${get() ? 'on' : 'off'}. Use /${name} on|off to change it.`))
      }
      return { kind: 'continue' }
    }

    if (arg === 'on' || arg === 'off') {
      apply(arg === 'on')
      return { kind: 'continue' }
    }

    console.warn(red(`Usage: /${name} [on|off].`))
    return { kind: 'continue' }
  }

  return { name, description, run }
}
