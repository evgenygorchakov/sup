import { stdout } from 'node:process'

const DEFAULT_COLUMNS = 80
const ESCAPE = '\x1B'
const ANSI_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g')

export const ERASE_BELOW_CURSOR = `${ESCAPE}[0J`

export interface PromptLineBuffer {
  line?: string
  cursor?: number
  getPrompt?: () => string
}

function moveDown(rows: number): string {
  return rows > 0 ? `${ESCAPE}[${rows}B` : ''
}

function moveUp(rows: number): string {
  return rows > 0 ? `${ESCAPE}[${rows}A` : ''
}

function moveToColumn(column: number): string {
  return column > 0 ? `\r${ESCAPE}[${column}C` : '\r'
}

function lastPromptLineWidth(readline: PromptLineBuffer): number {
  const prompt = readline.getPrompt?.() ?? ''
  const lastLine = prompt.slice(prompt.lastIndexOf('\n') + 1)
  return [...lastLine.replace(ANSI_SEQUENCE, '')].length
}

function rowsAdvancedBy(content: string, columns: number, startColumn: number): number {
  let rows = 0
  let column = startColumn

  for (const character of content.replace(ANSI_SEQUENCE, '')) {
    if (character === '\n') {
      rows += 1
      column = 0
    }
    else if (character === '\r') {
      column = 0
    }
    else {
      if (column >= columns) {
        rows += 1
        column = 0
      }
      column += 1
    }
  }

  return rows
}

export function paintBelowCursor(readline: PromptLineBuffer, content: string): void {
  const columns = stdout.columns ?? DEFAULT_COLUMNS
  const line = readline.line ?? ''
  const cursor = readline.cursor ?? line.length
  const promptWidth = lastPromptLineWidth(readline)

  const cursorOffset = promptWidth + cursor
  const lineEndOffset = promptWidth + line.length
  const rowsToLineEnd = Math.floor(lineEndOffset / columns) - Math.floor(cursorOffset / columns)
  const lineEndColumn = lineEndOffset % columns

  const toLineEnd = moveDown(rowsToLineEnd) + moveToColumn(lineEndColumn)
  const painted = rowsAdvancedBy(content, columns, lineEndColumn)
  const backToCursor = moveUp(painted + rowsToLineEnd) + moveToColumn(cursorOffset % columns)

  stdout.write(toLineEnd + ERASE_BELOW_CURSOR + content + backToCursor)
}
