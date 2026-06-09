import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'

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

async function fileExists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute)
    return true
  }
  catch {
    return false
  }
}

async function generateUniquePlanName(dir: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}`
    if (!(await fileExists(join(dir, `${name}.md`)))) {
      return name
    }
  }

  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Date.now().toString(36)}`
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

    const name = await generateUniquePlanName(dir)
    const absolute = join(dir, `${name}.md`)

    const content = [
      `# ${name}`,
      '',
      `_Created: ${formatTimestamp(new Date())}_`,
      '',
      `**Request:** ${userRequest.trim() || '—'}`,
      '',
      '---',
      '',
      plan,
      '',
    ].join('\n')

    await writeFile(absolute, content, 'utf8')

    return `${PLANS_SUBDIR.join('/')}/${name}.md`
  }
  catch {
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

  const summaries: PlanSummary[] = []

  for (const entry of entries) {
    if (!entry.endsWith('.md')) {
      continue
    }

    const file = join(dir, entry)
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      continue
    }

    const content = await readFile(file, 'utf8').catch(() => '')
    const request = REQUEST_LINE_PATTERN.exec(content)?.[1]?.trim() ?? ''

    summaries.push({ name: entry.replace(/\.md$/, ''), file, modified: info.mtime, request })
  }

  summaries.sort((a, b) => b.modified.getTime() - a.modified.getTime())

  return summaries
}

export async function readPlanContent(file: string): Promise<string | null> {
  return await readFile(file, 'utf8').catch(() => null)
}
