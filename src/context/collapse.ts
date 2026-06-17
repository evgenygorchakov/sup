import type { Message } from '../types.ts'
import { Config } from '../config.ts'

const COLLAPSE_NOTICE = '\n[older tool output collapsed to save context; run the tool again if you need it]'
const PREVIEW_CHARS = 200

export function collapseOldToolResults(messages: Message[]): void {
  if (!Config.USE_TOOL_RESULT_COLLAPSE) {
    return
  }

  const toolIndices = messages.reduce<number[]>((indices, message, index) => {
    if (message.role === 'tool') {
      indices.push(index)
    }
    return indices
  }, [])

  const cutoff = toolIndices.length - Config.TOOL_RESULT_KEEP_RECENT

  for (let position = 0; position < cutoff; position += 1) {
    const message = messages[toolIndices[position]!]!

    if (message.content.length <= Config.TOOL_RESULT_COLLAPSE_MIN_CHARS || message.content.endsWith(COLLAPSE_NOTICE)) {
      continue
    }

    message.content = message.content.slice(0, PREVIEW_CHARS) + COLLAPSE_NOTICE
  }
}
