import type { Skill } from './types.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { yellow } from '../utils/colors.ts'
import { parseFrontmatter } from './loader.ts'

const SKILLS_SUBDIR = ['.sup', 'skills']
const SKILL_FILE = 'SKILL.md'

function listSkillFiles(skillDir: string): string[] {
  return readdirSync(skillDir, { recursive: true })
    .map(String)
    .filter(file => file !== SKILL_FILE && statSync(join(skillDir, file), { throwIfNoEntry: false })?.isFile())
    .sort()
}

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
    const description = meta.description?.replace(/\s+/g, ' ').trim()
    if (!description) {
      console.warn(yellow(`Skipping skill "${entry}": missing description in ${SKILL_FILE} frontmatter.`))
      continue
    }

    loaded.push({ name: entry, description, body, dir: skillDir, files: listSkillFiles(skillDir) })
  }

  return loaded
}

export const skills: Skill[] = loadSkills()

const skillsByName: Record<string, Skill> = Object.fromEntries(
  skills.map(skill => [skill.name, skill]),
)

export function findSkill(selector: string): Skill | undefined {
  const lowered = selector.toLowerCase()
  return skillsByName[selector]
    ?? skills.find(skill => skill.name.toLowerCase() === lowered)
    ?? skills.find(skill => skill.name.toLowerCase().includes(lowered))
}

export function renderSkillContent(skill: Skill): string {
  const sections = [`# Skill: ${skill.name}`, '', skill.body]

  if (skill.files.length > 0) {
    const paths = skill.files.map(file => relative(process.cwd(), join(skill.dir, file)))
    sections.push('', `Bundled files you can open with read_file: ${paths.join(', ')}`)
  }

  return sections.join('\n')
}

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
