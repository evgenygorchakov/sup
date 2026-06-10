import type { Skill } from './types.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { yellow } from '../utils/colors.ts'
import { parseFrontmatter } from './loader.ts'

const SKILLS_SUBDIR = ['.sup', 'skills']
const SKILL_FILE = 'SKILL.md'

function loadSkills(): Skill[] {
  const dir = resolve(process.cwd(), ...SKILLS_SUBDIR)

  let entries: string[]
  try {
    entries = readdirSync(dir)
  }
  catch {
    return []
  }

  const loaded: Skill[] = []

  for (const entry of entries.sort()) {
    const skillDir = join(dir, entry)
    if (!statSync(skillDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue
    }

    let raw: string
    try {
      raw = readFileSync(join(skillDir, SKILL_FILE), 'utf8')
    }
    catch {
      continue
    }

    const { meta, body } = parseFrontmatter(raw)
    const description = meta.description?.trim()
    if (!description) {
      console.warn(yellow(`Skipping skill "${entry}": missing description in ${SKILL_FILE} frontmatter.`))
      continue
    }

    const files = readdirSync(skillDir)
      .filter(file => file !== SKILL_FILE && statSync(join(skillDir, file), { throwIfNoEntry: false })?.isFile())
      .sort()

    loaded.push({ name: entry, description, body, dir: skillDir, files })
  }

  return loaded
}

export const skills: Skill[] = loadSkills()

export const skillsByName: Record<string, Skill> = Object.fromEntries(
  skills.map(skill => [skill.name, skill]),
)

export function buildSkillsPromptSection(): string {
  if (skills.length === 0) {
    return ''
  }

  return [
    '# Skills',
    '- Skills are reusable, on-demand instruction sets for specific tasks.',
    '- When the current task matches a skill below, call the `skill` tool with its name to load the full instructions BEFORE proceeding, then follow them.',
    ...skills.map(skill => `- ${skill.name} — ${skill.description}`),
  ].join('\n')
}
