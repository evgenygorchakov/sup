import type { Skill } from './types.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { Config } from '../config.ts'
import { yellow } from '../utils/colors.ts'
import { parseFrontmatter } from './loader.ts'

const SKILL_FILE = 'SKILL.md'
const SUP_SKILLS_DIR = '.sup/skills'
const CLAUDE_SKILLS_DIR = '.claude/skills'

/** Own skills first, so a name in `.sup/skills` wins over the same one in `.claude/skills`. */
export const skillDirs: readonly string[] = Config.USE_CLAUDE_SKILLS
  ? [SUP_SKILLS_DIR, CLAUDE_SKILLS_DIR]
  : [SUP_SKILLS_DIR]

function listSkillFiles(skillDir: string): string[] {
  return readdirSync(skillDir, { recursive: true })
    .map(String)
    .filter(file => file !== SKILL_FILE && statSync(join(skillDir, file), { throwIfNoEntry: false })?.isFile())
    .sort()
}

function loadSkillsFrom(dir: string, taken: Set<string>): Skill[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  }
  catch {
    return []
  }

  const loaded: Skill[] = []

  for (const entry of entries.sort()) {
    if (taken.has(entry.toLowerCase())) {
      continue
    }

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

    taken.add(entry.toLowerCase())
    loaded.push({ name: entry, description, body, dir: skillDir, files: listSkillFiles(skillDir) })
  }

  return loaded
}

function loadSkills(): Skill[] {
  const taken = new Set<string>()

  return skillDirs
    .flatMap(dir => loadSkillsFrom(resolve(process.cwd(), dir), taken))
    .sort((left, right) => left.name.localeCompare(right.name))
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
