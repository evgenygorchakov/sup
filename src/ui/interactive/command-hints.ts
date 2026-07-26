import type { EventEmitter } from 'node:events'
import type { SlashCommand } from '../../commands/types.ts'
import type { PromptLineBuffer } from './below-cursor.ts'
import { stdout } from 'node:process'
import { gray } from '../../utils/colors.ts'
import { ERASE_BELOW_CURSOR, paintBelowCursor } from './below-cursor.ts'

const MAX_PANEL_ROWS = 10
const PROMPT_ROWS = 4
const DECORATION_WIDTH = 7
const MIN_DESCRIPTION_ROOM = 10
const DEFAULT_COLUMNS = 80
const DEFAULT_ROWS = 24

function isCommandPrefix(line: string): boolean {
  return line.startsWith('/') && !line.includes(' ')
}

function matchingCommands(line: string, commands: readonly SlashCommand[]): SlashCommand[] {
  const typed = line.slice(1).toLowerCase()
  return commands.filter(command => command.name.startsWith(typed))
}

function commonPrefix(names: string[]): string {
  return names.reduce((prefix, name) => {
    let length = 0
    while (length < prefix.length && length < name.length && prefix[length] === name[length]) {
      length++
    }
    return prefix.slice(0, length)
  })
}

function renderHintPanel(matches: readonly SlashCommand[]): string {
  const columns = stdout.columns ?? DEFAULT_COLUMNS
  const limit = Math.min(MAX_PANEL_ROWS, Math.max(1, (stdout.rows ?? DEFAULT_ROWS) - PROMPT_ROWS))
  const shown = matches.slice(0, limit)
  const nameWidth = Math.max(...shown.map(command => command.name.length + 1))
  const room = Math.max(MIN_DESCRIPTION_ROOM, columns - nameWidth - DECORATION_WIDTH)

  const lines = shown.map((command) => {
    const name = `/${command.name}`.padEnd(nameWidth)
    const description = command.description.length > room
      ? `${command.description.slice(0, room - 1)}…`
      : command.description
    return `\r\n  ${name}  ${gray(`— ${description}`)}`
  })

  if (matches.length > shown.length) {
    lines.push(`\r\n  ${gray(`… ${matches.length - shown.length} more`)}`)
  }

  return lines.join('')
}

export function createSlashCompleter(commands: readonly SlashCommand[]): (line: string) => [string[], string] {
  return (line) => {
    if (!isCommandPrefix(line)) {
      return [[], line]
    }

    const matches = matchingCommands(line, commands).map(command => `/${command.name}`)
    if (matches.length <= 1) {
      return [matches, line]
    }

    return [[commonPrefix(matches)], line]
  }
}

export function installCommandHints(
  inputStream: EventEmitter,
  readline: PromptLineBuffer,
  commands: readonly SlashCommand[],
): { setActive: (value: boolean) => void } {
  let active = false
  let panelVisible = false

  function paint(content: string): void {
    paintBelowCursor(readline, content)
  }

  function render(): void {
    const line = readline.line ?? ''
    const matches = isCommandPrefix(line) ? matchingCommands(line, commands) : []

    if (matches.length === 0) {
      if (panelVisible) {
        paint('')
        panelVisible = false
      }
      return
    }

    paint(renderHintPanel(matches))
    panelVisible = true
  }

  function eraseAfterSubmit(): void {
    if (panelVisible) {
      stdout.write(ERASE_BELOW_CURSOR)
      panelVisible = false
    }
  }

  inputStream.on('keypress', (_input: string, key?: { name?: string }) => {
    if (!active) {
      return
    }

    if (key?.name === 'return' || key?.name === 'enter') {
      eraseAfterSubmit()
      return
    }

    render()
  })

  return {
    setActive(value) {
      active = value
      if (!active) {
        eraseAfterSubmit()
      }
    },
  }
}
