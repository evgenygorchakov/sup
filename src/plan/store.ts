import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { yellow } from '../utils/colors.ts'

const PLANS_SUBDIR = ['.sup', 'plans']

const ADJECTIVES = [
  'pure',
  'swirling',
  'quiet',
  'amber',
  'brave',
  'calm',
  'clever',
  'crimson',
  'dapper',
  'eager',
  'faint',
  'gentle',
  'golden',
  'hidden',
  'jolly',
  'lucky',
  'mellow',
  'nimble',
  'polished',
  'rustic',
  'silent',
  'snowy',
  'velvet',
  'wandering',
]

const NOUNS = [
  'fountain',
  'pelican',
  'meadow',
  'lantern',
  'comet',
  'willow',
  'anchor',
  'beacon',
  'canyon',
  'ember',
  'falcon',
  'glacier',
  'marble',
  'orchard',
  'pebble',
  'quartz',
  'ripple',
  'summit',
  'thicket',
  'tundra',
  'vortex',
  'wharf',
  'zephyr',
  'harbor',
]

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

async function writeExclusively(dir: string, name: string, content: string): Promise<boolean> {
  try {
    await writeFile(join(dir, `${name}.md`), content, { encoding: 'utf8', flag: 'wx' })
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
}

async function writePlanUniquely(dir: string, buildContent: (name: string) => string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}`
    if (await writeExclusively(dir, name, buildContent(name))) {
      return name
    }
  }

  const fallback = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Date.now().toString(36)}`
  await writeFile(join(dir, `${fallback}.md`), buildContent(fallback), { encoding: 'utf8', flag: 'wx' })
  return fallback
}

export function formatTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${datePart} ${timePart}`
}

export async function savePlan(planMarkdown: string, userRequest: string): Promise<string | null> {
  const plan = planMarkdown.trim()
  if (!plan) {
    return null
  }

  try {
    const dir = resolve(process.cwd(), ...PLANS_SUBDIR)
    await mkdir(dir, { recursive: true })

    const name = await writePlanUniquely(dir, planName => [
      `# ${planName}`,
      '',
      `_Created: ${formatTimestamp(new Date())}_`,
      '',
      `**Request:** ${userRequest.replace(/\s+/g, ' ').trim() || '—'}`,
      '',
      '---',
      '',
      plan,
      '',
    ].join('\n'))

    return `${PLANS_SUBDIR.join('/')}/${name}.md`
  }
  catch (error) {
    console.warn(yellow(`Could not save the plan to ${PLANS_SUBDIR.join('/')}: ${error instanceof Error ? error.message : String(error)}`))
    return null
  }
}

export interface PlanSummary {
  name: string
  file: string
  modified: Date
  request: string
}

const REQUEST_LINE_PATTERN = /^\*\*Request:\*\*\s*(\S.*)$/m

export async function listPlans(): Promise<PlanSummary[]> {
  const dir = resolve(process.cwd(), ...PLANS_SUBDIR)

  let entries: string[]
  try {
    entries = await readdir(dir)
  }
  catch {
    return []
  }

  const summaries = await Promise.all(entries.filter(entry => entry.endsWith('.md')).map(async (entry) => {
    const file = join(dir, entry)
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      return null
    }

    const content = await readFile(file, 'utf8').catch(() => '')
    const request = REQUEST_LINE_PATTERN.exec(content)?.[1]?.trim() ?? ''

    return { name: entry.replace(/\.md$/, ''), file, modified: info.mtime, request }
  }))

  return summaries
    .filter(summary => summary !== null)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

export async function readPlanContent(file: string): Promise<string | null> {
  return await readFile(file, 'utf8').catch(() => null)
}

const METADATA_HEADER_PATTERN = /^# \S[^\n]*\n\n_Created: [^\n]+_\n\n\*\*Request:\*\* [^\n]+\n\n---\n\n/

export function planBody(content: string): string {
  return content.replace(METADATA_HEADER_PATTERN, '')
}
