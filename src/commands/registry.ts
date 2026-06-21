import type { CommandEnv, CommandResult, SlashCommand } from './types.ts'
import { red } from '../utils/colors.ts'
import { babysitterCommand } from './list/babysitter.ts'
import { clearCommand } from './list/clear.ts'
import { exitCommand } from './list/exit.ts'
import { helpCommand } from './list/help.ts'
import { modelCommand } from './list/model.ts'
import { planModeCommand } from './list/plan-mode.ts'
import { runPlanCommand } from './list/run-plan.ts'
import { showThinkingCommand } from './list/show-thinking.ts'
import { skillsCommand } from './list/skills.ts'
import { thinkingCommand } from './list/thinking.ts'
import { verboseCommand } from './list/verbose.ts'

export const commands: SlashCommand[] = [
  exitCommand,
  helpCommand,
  clearCommand,
  modelCommand,
  runPlanCommand,
  planModeCommand,
  thinkingCommand,
  showThinkingCommand,
  verboseCommand,
  skillsCommand,
  babysitterCommand,
]

const commandsByName = new Map(commands.map(command => [command.name, command]))

export async function runSlashCommand(input: string, env: CommandEnv): Promise<CommandResult> {
  const parts = input.slice(1).trim().split(/\s+/)
  const name = (parts[0] ?? '').toLowerCase() || 'help'
  const args = parts.slice(1)
  const command = commandsByName.get(name)

  if (!command) {
    console.warn(red(`Unknown command: /${name}. Type /help.`))
    return { kind: 'continue' }
  }

  return await command.run({ ...env, args, commands })
}
