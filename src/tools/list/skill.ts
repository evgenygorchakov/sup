import type { Tool } from '../../types.ts'
import { activateSkill } from '../../babysitter/index.ts'
import { findSkill, renderSkillContent, skills } from '../../skills/registry.ts'
import { blue } from '../../utils/colors.ts'

const skillNames = skills.map(skill => skill.name)

export const skill: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'skill',
      description: `Loads the full instructions for a named skill so you can carry them out. Skills are reusable, on-demand procedures for specific tasks; their names and descriptions are listed under "Skills" in your system prompt. USE WHEN: the current task matches one of the available skills — call this first to load its instructions, then follow them. Available skills: ${skillNames.join(', ')}. EXAMPLE: {"name": "${skillNames[0] ?? 'skill-name'}"}.`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the skill to load.',
            enum: skillNames,
          },
        },
        required: ['name'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { name?: unknown }
    const name = args.name

    if (typeof name !== 'string' || name.length === 0) {
      return 'ERROR: skill expects { name: string }'
    }

    const found = findSkill(name)
    if (!found) {
      const available = skillNames.length > 0 ? skillNames.join(', ') : '(none)'
      return `ERROR: unknown skill "${name}". Available skills: ${available}`
    }

    const sections = [renderSkillContent(found)]

    const gateNote = activateSkill(found)
    if (gateNote) {
      sections.push(gateNote)
    }

    return sections.join('\n')
  },
  primaryArgs: ['name'],
  accentColor: blue,
  renderResult: (args) => {
    const name = typeof args.name === 'string' ? args.name : ''
    return `Loaded skill "${name}"`
  },
  autoApprove: true,
}
