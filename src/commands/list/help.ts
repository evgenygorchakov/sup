import type { SlashCommand } from '../types.ts'
import { Config } from '../../config.ts'
import { bold, brightGreen, gray } from '../../utils/colors.ts'

export const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands.',
  run: (context) => {
    console.warn(bold(brightGreen('\nCommands:')))
    for (const command of context.commands) {
      console.warn(`  ${brightGreen(`/${command.name}`)} ${gray(`— ${command.description}`)}`)
    }
    if (Config.USE_IMAGE_INPUT) {
      console.warn(gray('\nImages: type a path to an image (e.g. ./shot.png) or press Ctrl+V to paste from the clipboard. Needs a vision-capable model.'))
    }
    return { kind: 'continue' }
  },
}
