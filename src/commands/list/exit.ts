import type { SlashCommand } from '../types.ts'

export const exitCommand: SlashCommand = {
  name: 'exit',
  description: 'Quit the session.',
  run: () => ({ kind: 'exit' }),
}
