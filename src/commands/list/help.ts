import type { SlashCommand } from '../types.ts'
import { Config } from '../../config.ts'
import { bold, brightGreen, gray } from '../../utils/colors.ts'

export const helpCommand: SlashCommand = {
  name: 'help',
  description: 'Show available commands.',
  run: (context) => {
    console.warn(bold(brightGreen('\nCommands:')))
    for (const command of context.commands.filter(command => !command.isSkill)) {
      console.warn(`  ${brightGreen(`/${command.name}`)} ${gray(`— ${command.description}`)}`)
    }

    const skillCommands = context.commands.filter(command => command.isSkill)
    if (skillCommands.length > 0) {
      console.warn(gray(`\nSkills as commands: ${skillCommands.map(command => `/${command.name}`).join(', ')}`))
      console.warn(gray('Type /skills to see what each one does.'))
    }

    console.warn(gray('\nImages: type a path to an image (e.g. ./shot.png) or press Ctrl+V to paste from the clipboard. Needs a vision-capable model.'))
    console.warn(gray(Config.USE_STT
      ? 'Dictation: press Ctrl+G to start recording, then Enter to send, Ctrl+G to insert without sending, or Esc to cancel. /stt turns it off.'
      : 'Dictation and spoken answers are off: both need a local speech server — see optional/README.md, then /stt or /tts.'))
    return { kind: 'continue' }
  },
}
