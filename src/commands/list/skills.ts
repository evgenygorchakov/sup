import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { activateSkill } from '../../babysitter/index.ts'
import { findSkill, renderSkillContent, skills } from '../../skills/registry.ts'
import { bold, brightGreen, gray, red } from '../../utils/colors.ts'

function run(context: CommandContext): CommandResult {
  if (skills.length === 0) {
    console.warn(gray('No skills in .sup/skills yet.'))
    return { kind: 'continue' }
  }

  const selector = context.args[0]

  if (!selector) {
    console.warn(bold(brightGreen('\nSkills:')))
    skills.forEach((skill, index) => {
      console.warn(`  ${brightGreen(String(index + 1))}  ${skill.name} ${gray(`— ${skill.description}`)}`)
    })
    console.warn(gray('\nThe model loads a skill on demand via the skill tool. Force one now with /skills <number|name> [task].'))
    return { kind: 'continue' }
  }

  const index = Number(selector)
  const chosen = Number.isInteger(index) && index >= 1
    ? skills[index - 1]
    : findSkill(selector)

  if (!chosen) {
    console.warn(red(`No skill matching "${selector}". Type /skills to list them.`))
    return { kind: 'continue' }
  }

  const task = context.args.slice(1).join(' ')
  const instruction = task
    ? `Apply this skill to the following task:\n${task}`
    : 'Carry out this skill now, asking for missing details if the instructions require them.'

  const sections = [renderSkillContent(chosen)]

  const gateNote = activateSkill(chosen)
  if (gateNote) {
    sections.push(gateNote)
  }

  sections.push('', instruction)

  context.messages.push({ role: 'user', content: sections.join('\n') })
  console.warn(gray(`Loaded skill "${chosen.name}"…`))

  return { kind: 'run' }
}

export const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List skills from .sup/skills, or force-load one: /skills [number|name] [task].',
  run,
}
