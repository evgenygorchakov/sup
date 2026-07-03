import type { Message } from '../types.ts'
import { Config } from '../config.ts'

const COLLAPSE_NOTICE = '\n[older tool output collapsed to save context; use read-only tools like read_file or grep to fetch it again if needed]'
const PREVIEW_CHARS = 200
const HIGH_SURROGATE_START = 0xD800
const HIGH_SURROGATE_END = 0xDBFF

function previewWithoutSplitSurrogate(content: string): string {
  const preview = content.slice(0, PREVIEW_CHARS)
  const lastCode = preview.charCodeAt(preview.length - 1)
  return lastCode >= HIGH_SURROGATE_START && lastCode <= HIGH_SURROGATE_END ? preview.slice(0, -1) : preview
}

function isCollapsible(message: Message): boolean {
  return message.content.length > Config.TOOL_RESULT_COLLAPSE_MIN_CHARS && !message.content.endsWith(COLLAPSE_NOTICE)
}

export function collapseOldToolResults(messages: Message[]): void {
  if (!Config.USE_TOOL_RESULT_COLLAPSE) {
    return
  }

  const toolMessages = messages.filter(message => message.role === 'tool')
  const keepRecent = Math.max(0, Config.TOOL_RESULT_KEEP_RECENT)
  const oldToolMessages = toolMessages.slice(0, Math.max(0, toolMessages.length - keepRecent))
  const collapsible = oldToolMessages.filter(isCollapsible)

  if (collapsible.length < Math.max(1, Config.TOOL_RESULT_COLLAPSE_BATCH)) {
    return
  }

  for (const message of collapsible) {
    message.content = previewWithoutSplitSurrogate(message.content) + COLLAPSE_NOTICE
  }
}
