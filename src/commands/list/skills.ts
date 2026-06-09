import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { skills } from '../../skills/registry.ts'
import { bold, brightGreen, gray } from '../../utils/colors.ts'

function run(_context: CommandContext): CommandResult {
  if (skills.length === 0) {
    console.warn(gray('No skills in .sup/skills yet.'))
    return { kind: 'continue' }
  }

  console.warn(bold(brightGreen('\nSkills:')))
  for (const skill of skills) {
    console.warn(`  ${brightGreen(skill.name)} ${gray(`— ${skill.description}`)}`)
  }
  console.warn(gray('\nThe model loads a skill on demand via the skill tool.'))

  return { kind: 'continue' }
}

export const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List skills available from .sup/skills.',
  run,
}
