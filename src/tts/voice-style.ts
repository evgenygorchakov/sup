import { Config } from '../config.ts'

const SPOKEN_OPENING = 'Reminder from the harness, not from the user. Your final reply will be read aloud by a speech synthesizer, so write it to be heard, not read.'

const SPOKEN_FORMAT = [
  '- This governs the shape of that reply, never its length or its register — those are already settled by the style rules in your system prompt. If the task still needs tools, keep calling them as usual.',
  '- Plain spoken sentences: no markdown, no lists, no headings, no tables, no code.',
  '- Never dictate file paths, URLs, identifiers, or line numbers — they are unlistenable. Name things in words ("the speaker module"); the exact text is already on the screen.',
  '- Say numbers and units the way a person would say them out loud.',
]

export function buildVoiceStyleReminder(): string | null {
  if (!Config.USE_TTS) {
    return null
  }
  return [SPOKEN_OPENING, ...SPOKEN_FORMAT].join('\n')
}
