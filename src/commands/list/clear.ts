import type { SlashCommand } from '../types.ts'
import { clearConversation } from '../../babysitter/index.ts'
import { takePendingImages } from '../../images/pending.ts'
import { clearActivePlan } from '../../plan/active-plan.ts'
import { resetContextUsage } from '../../providers/context-usage.ts'
import { gray } from '../../utils/colors.ts'

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the conversation history.',
  run: (context) => {
    context.messages.length = 1
    resetContextUsage()
    clearActivePlan()
    clearConversation()
    takePendingImages()
    console.warn(gray('Conversation cleared.'))
    return { kind: 'continue' }
  },
}
