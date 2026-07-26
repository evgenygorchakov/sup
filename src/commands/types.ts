import type { Message } from '../types.ts'

export type CommandResult
  = | { kind: 'continue' }
    | { kind: 'exit' }
    | { kind: 'run' }

export interface CommandContext {
  messages: Message[]
  args: string[]
  commands: readonly SlashCommand[]
}

export interface SlashCommand {
  name: string
  description: string
  isSkill?: boolean
  run: (context: CommandContext) => CommandResult | Promise<CommandResult>
}

export interface CommandEnv {
  messages: Message[]
}
