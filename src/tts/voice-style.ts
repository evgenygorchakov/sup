import { Config } from '../config.ts'
import { hasPersona } from '../persona.ts'

const SPOKEN_OPENING = 'Reminder from the harness, not from the user. Your final reply will be read aloud by a speech synthesizer, so write it to be heard, not read.'

const SPOKEN_FORMAT = [
  '- Plain spoken sentences: no markdown, no lists, no headings, no tables, no code.',
  '- Never dictate file paths, URLs, identifiers, or line numbers — they are unlistenable. Name things in words ("the speaker module"); the exact text is already on the screen.',
  '- Say numbers and units the way a person would say them out loud.',
]

const SPOKEN_LENGTH = '- Lead with the answer, then at most a couple of sentences of detail.'
const WRITTEN_LENGTH = '- Speech changes the wording, never the length: keep the reply as short as the style rules in your system prompt ask for.'

const VOICE_STYLE_REMINDER_IN_CHARACTER = [
  SPOKEN_OPENING,
  '- This governs the shape of that reply, never its voice: the persona still decides how you sound and how much you say. If the task still needs tools, keep calling them as usual.',
  ...SPOKEN_FORMAT,
].join('\n')

export function buildVoiceStyleReminder(): string | null {
  if (!Config.USE_TTS) {
    return null
  }
  if (hasPersona()) {
    return VOICE_STYLE_REMINDER_IN_CHARACTER
  }
  return [
    SPOKEN_OPENING,
    '- This governs the wording of that reply only. If the task still needs tools, keep calling them as usual.',
    ...SPOKEN_FORMAT,
    Config.VOICE_MODE_SHORT ? WRITTEN_LENGTH : SPOKEN_LENGTH,
  ].join('\n')
}
