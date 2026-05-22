import type { Message } from './types.ts'

import { bold, brightGreen, gray, red } from './utils/colors.ts'

interface CommandContext {
  messages: Message[]
}

export type CommandResult
  = | { kind: 'continue' }
    | { kind: 'exit' }

interface SlashCommand {
  name: string
  description: string
  run: (context: CommandContext) => CommandResult
}

const commands: SlashCommand[] = [
  {
    name: 'exit',
    description: 'Quit the session.',
    run: () => ({ kind: 'exit' }),
  },
  {
    name: 'help',
    description: 'Show available commands.',
    run: () => {
      console.warn(bold(brightGreen('\nCommands:')))
      for (const command of commands) {
        console.warn(`  ${brightGreen(`/${command.name}`)} ${gray(`— ${command.description}`)}`)
      }
      return { kind: 'continue' }
    },
  },
  {
    name: 'clear',
    description: 'Clear the conversation history.',
    run: (context) => {
      context.messages.length = 1
      console.warn(gray('Conversation cleared.'))
      return { kind: 'continue' }
    },
  },
]

const commandsByName = new Map(commands.map(command => [command.name, command]))

export function runSlashCommand(input: string, context: CommandContext): CommandResult {
  const name = input.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const command = commandsByName.get(name)

  if (!command) {
    console.warn(red(`Unknown command: /${name}. Type /help.`))
    return { kind: 'continue' }
  }

  return command.run(context)
}
