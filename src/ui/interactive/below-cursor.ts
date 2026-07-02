import { stdout } from 'node:process'

const SAVE_CURSOR = '\x1B7'
const RESTORE_CURSOR = '\x1B8'

export const ERASE_BELOW_CURSOR = '\x1B[0J'

export interface PromptLineBuffer {
  line?: string
  cursor?: number
}

export function paintBelowCursor(readline: PromptLineBuffer, content: string): void {
  const line = readline.line ?? ''
  const cursor = readline.cursor ?? line.length
  const columnsToLineEnd = Math.max(line.length - cursor, 0)
  const moveToLineEnd = columnsToLineEnd > 0 ? `\x1B[${columnsToLineEnd}C` : ''
  stdout.write(SAVE_CURSOR + moveToLineEnd + ERASE_BELOW_CURSOR + content + RESTORE_CURSOR)
}
