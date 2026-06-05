import type { SlashCommand } from '../types.ts'
import { bold, brightGreen, gray } from '../../utils/colors.ts'

export const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands.',
  run: (context) => {
    console.warn(bold(brightGreen('\nCommands:')))
    for (const command of context.commands) {
      console.warn(`  ${brightGreen(`/${command.name}`)} ${gray(`— ${command.description}`)}`)
    }
    return { kind: 'continue' }
  },
}
