import type { SlashCommand } from '../types.ts'
import { resetContextUsage } from '../../providers/ollama/context-window.ts'
import { gray } from '../../utils/colors.ts'

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the conversation history.',
  run: (context) => {
    context.messages.length = 1
    resetContextUsage()
    console.warn(gray('Conversation cleared.'))
    return { kind: 'continue' }
  },
}
