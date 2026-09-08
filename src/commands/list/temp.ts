import type { SelectChoice } from '../../ui/interactive/select.ts'
import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { stdin } from 'node:process'
import { Config } from '../../config.ts'
import { selectFromList } from '../../ui/interactive/select.ts'
import { gray, red } from '../../utils/colors.ts'

const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 2
const PRESETS: (number | null)[] = [null, 0, 0.2, 0.6, 1]

const PRESET_CHOICES: SelectChoice[] = PRESETS.map(preset => preset === null
  ? { label: 'default', hint: 'the model\'s own' }
  : { label: String(preset) })

const USAGE = `Usage: /temp <${MIN_TEMPERATURE}-${MAX_TEMPERATURE}|default>.`

function describe(temperature: number | null): string {
  return temperature === null ? 'default (the model\'s own)' : String(temperature)
}

function apply(temperature: number | null): void {
  Config.TEMPERATURE = temperature
  console.warn(gray(`temperature is now ${describe(temperature)}.`))
}

async function chooseInteractively(): Promise<void> {
  const currentIndex = PRESETS.indexOf(Config.TEMPERATURE)
  const selectedIndex = await selectFromList('temperature', PRESET_CHOICES, Math.max(currentIndex, 0))
  if (selectedIndex === null) {
    return
  }

  apply(PRESETS[selectedIndex] ?? null)
}

async function run(context: CommandContext): Promise<CommandResult> {
  const arg = context.args[0]?.toLowerCase()

  if (!arg) {
    if (stdin.isTTY) {
      await chooseInteractively()
    }
    else {
      console.warn(gray(`temperature is ${describe(Config.TEMPERATURE)}. ${USAGE}`))
    }
    return { kind: 'continue' }
  }

  if (arg === 'default') {
    apply(null)
    return { kind: 'continue' }
  }

  const temperature = Number(arg)
  if (!Number.isFinite(temperature) || temperature < MIN_TEMPERATURE || temperature > MAX_TEMPERATURE) {
    console.warn(red(USAGE))
    return { kind: 'continue' }
  }

  apply(temperature)
  return { kind: 'continue' }
}

export const tempCommand: SlashCommand = {
  name: 'temp',
  description: 'Set sampling temperature: /temp opens a menu, or /temp <0-2|default> to hand it back to the model.',
  run,
}
