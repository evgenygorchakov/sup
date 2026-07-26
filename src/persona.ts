import { readFile } from 'node:fs/promises'
import { Config, resolveFromInstallDir } from './config.ts'
import { yellow } from './utils/colors.ts'

type Script = 'cyrillic' | 'latin'

const ANCHOR_CHAR_LIMIT = 400
const SCRIPT_SAMPLE_MINIMUM = 40
const LANGUAGE_SCRIPTS: Record<string, Script> = { russian: 'cyrillic', english: 'latin' }

let persona: string | null = null

export async function loadPersona(): Promise<string | null> {
  if (!Config.PERSONA_FILE) {
    return null
  }
  const filePath = resolveFromInstallDir(Config.PERSONA_FILE)
  try {
    const fileContent = (await readFile(filePath, 'utf8')).trim()
    if (!fileContent) {
      console.warn(yellow(`⚠  PERSONA_FILE is empty: ${filePath}`))
      return null
    }
    persona = fileContent
    return fileContent
  }
  catch {
    console.warn(yellow(`⚠  PERSONA_FILE not readable, running without a persona: ${filePath}`))
    return null
  }
}

export function hasPersona(): boolean {
  return persona !== null
}

function dominantScript(text: string): Script | null {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (cyrillic + latin < SCRIPT_SAMPLE_MINIMUM) {
    return null
  }
  if (cyrillic > latin * 2) {
    return 'cyrillic'
  }
  return latin > cyrillic * 2 ? 'latin' : null
}

export function personaLanguageWarning(): string | null {
  if (!persona) {
    return null
  }
  const expected = LANGUAGE_SCRIPTS[Config.LANGUAGE.toLowerCase()]
  const script = dominantScript(persona)
  if (!expected || !script || script === expected) {
    return null
  }
  return `Persona is written in ${script === 'cyrillic' ? 'Cyrillic' : 'Latin'} script, but LANGUAGE=${Config.LANGUAGE} — replies and speech will disagree. Set LANGUAGE, TTS_HOST and TTS_VOICE to match the persona.`
}

function personaAnchor(text: string): string | null {
  const opening = text
    .split(/\n{2,}/)
    .map(block => block.trim())
    .find(block => block.length > 0 && !block.startsWith('#'))
  if (!opening) {
    return null
  }
  const oneLine = opening.replace(/\s+/g, ' ')
  if (oneLine.length <= ANCHOR_CHAR_LIMIT) {
    return oneLine
  }
  const clipped = oneLine.slice(0, ANCHOR_CHAR_LIMIT)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

export function buildPersonaReminder(): string | null {
  if (!persona) {
    return null
  }
  const anchor = personaAnchor(persona)
  return [
    'Reminder from the harness, not from the user. Answer in character. The persona in your system prompt is who you are, not a costume you drop once the topic turns practical.',
    anchor ? `You are: ${anchor}` : '',
    '- Speak the way that character speaks: its register, its forms of address, its way of seeing the world. Never mention being a model, an assistant, a prompt, or a harness.',
    '- Let the persona set the length and shape of the reply, over any habit of clipped assistant phrasing.',
    '- Staying in character never changes what is true: tool results, file contents, and facts are reported exactly as they are. Deliver them in character; never invent them.',
  ]
    .filter(Boolean)
    .join('\n')
}
