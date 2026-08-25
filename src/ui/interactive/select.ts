import type { Buffer } from 'node:buffer'
import { stdin, stdout } from 'node:process'
import { bold, brightGreen, gray } from '../../utils/colors.ts'
import { getInputStream } from './multiline-input.ts'

const HIDE_CURSOR = '\x1B[?25l'
const SHOW_CURSOR = '\x1B[?25h'
const ERASE_BELOW_CURSOR = '\x1B[0J'

const MOVE_UP_KEYS = ['\x1B[A', '\x1BOA', 'k']
const MOVE_DOWN_KEYS = ['\x1B[B', '\x1BOB', 'j']
const CONFIRM_KEYS = ['\r', '\n']
const CANCEL_KEYS = ['\x03', 'q', 'Q']
const ESCAPE_KEY = '\x1B'
const LONE_ESCAPE_CANCEL_MS = 50

const SEQUENCE_INTRODUCERS = ['[', 'O']

function isSequenceFinal(character: string): boolean {
  const code = character.charCodeAt(0)
  return code >= 0x40 && code <= 0x7E
}

function findSequenceEnd(buffer: string, start: number): number | null {
  if (start + 1 >= buffer.length) {
    return null
  }

  if (!SEQUENCE_INTRODUCERS.includes(buffer[start + 1]!)) {
    return start + 2
  }

  for (let index = start + 2; index < buffer.length; index += 1) {
    if (isSequenceFinal(buffer[index]!)) {
      return index + 1
    }
  }

  return null
}

export interface KeyStream {
  keys: string[]
  rest: string
}

export function readKeys(buffer: string): KeyStream {
  const keys: string[] = []
  let index = 0

  while (index < buffer.length) {
    if (buffer[index] !== ESCAPE_KEY) {
      const key = String.fromCodePoint(buffer.codePointAt(index)!)
      keys.push(key)
      index += key.length
      continue
    }

    const end = findSequenceEnd(buffer, index)
    if (end === null) {
      return { keys, rest: buffer.slice(index) }
    }

    if (SEQUENCE_INTRODUCERS.includes(buffer[index + 1]!)) {
      keys.push(buffer.slice(index, end))
    }
    index = end
  }

  return { keys, rest: '' }
}

export type MenuOutcome
  = | { kind: 'open', index: number }
    | { kind: 'confirmed', index: number }
    | { kind: 'cancelled' }

export function applyKeys(keys: readonly string[], index: number, count: number): MenuOutcome {
  if (count <= 0) {
    return { kind: 'cancelled' }
  }

  let current = Math.min(Math.max(index, 0), count - 1)

  for (const key of keys) {
    if (CONFIRM_KEYS.includes(key)) {
      return { kind: 'confirmed', index: current }
    }

    if (CANCEL_KEYS.includes(key)) {
      return { kind: 'cancelled' }
    }

    if (MOVE_UP_KEYS.includes(key)) {
      current = (current - 1 + count) % count
    }
    else if (MOVE_DOWN_KEYS.includes(key)) {
      current = (current + 1) % count
    }
  }

  return { kind: 'open', index: current }
}

export interface SelectChoice {
  label: string
  hint?: string
}

function moveCursorUp(lines: number): string {
  return `\x1B[${lines}A`
}

function renderMenu(title: string, choices: SelectChoice[], selectedIndex: number): void {
  const lines = [`${bold(title)}  ${gray('(↑/↓ · Enter · Esc)')}`, '']

  choices.forEach((choice, index) => {
    const isSelected = index === selectedIndex
    const pointer = isSelected ? brightGreen('❯ ') : '  '
    const label = isSelected ? brightGreen(choice.label) : choice.label
    const hint = choice.hint ? ` ${gray(choice.hint)}` : ''
    lines.push(`${pointer}${label}${hint}`)
  })

  stdout.write(`${lines.join('\n')}\n`)
}

export function selectFromList(title: string, choices: SelectChoice[], initialIndex = 0): Promise<number | null> {
  if (!stdin.isTTY || !stdout.isTTY || choices.length === 0) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const inputStream = getInputStream()
    const menuHeight = choices.length + 2
    let selectedIndex = Math.min(Math.max(initialIndex, 0), choices.length - 1)
    let pending = ''
    let escapeTimer: NodeJS.Timeout | null = null

    function clearEscapeTimer(): void {
      if (escapeTimer) {
        clearTimeout(escapeTimer)
        escapeTimer = null
      }
    }

    function eraseMenu(): void {
      stdout.write(moveCursorUp(menuHeight) + ERASE_BELOW_CURSOR)
    }

    function closeMenu(chosenIndex: number | null): void {
      clearEscapeTimer()
      pending = ''
      stdin.removeListener('data', handleKeypress)
      eraseMenu()
      stdout.write(SHOW_CURSOR)
      stdin.pipe(inputStream)
      resolve(chosenIndex)
    }

    function scheduleEscapeFlush(): void {
      escapeTimer = setTimeout(() => {
        escapeTimer = null
        const loneEscape = pending === ESCAPE_KEY
        pending = ''
        if (loneEscape) {
          closeMenu(null)
        }
      }, LONE_ESCAPE_CANCEL_MS)
    }

    function handleKeypress(chunk: Buffer): void {
      clearEscapeTimer()

      const { keys, rest } = readKeys(pending + chunk.toString('utf8'))
      pending = rest

      const outcome = applyKeys(keys, selectedIndex, choices.length)

      if (outcome.kind === 'confirmed') {
        closeMenu(outcome.index)
        return
      }

      if (outcome.kind === 'cancelled') {
        closeMenu(null)
        return
      }

      if (outcome.index !== selectedIndex) {
        selectedIndex = outcome.index
        eraseMenu()
        renderMenu(title, choices, selectedIndex)
      }

      if (pending) {
        scheduleEscapeFlush()
      }
    }

    stdin.unpipe(inputStream)
    stdout.write(HIDE_CURSOR)
    renderMenu(title, choices, selectedIndex)
    stdin.on('data', handleKeypress)
    stdin.resume()
  })
}
