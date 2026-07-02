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
  if (!stdin.isTTY || choices.length === 0) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    const inputStream = getInputStream()
    const menuHeight = choices.length + 2
    let selectedIndex = Math.min(Math.max(initialIndex, 0), choices.length - 1)
    let pendingEscape = ''
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
      stdin.removeListener('data', handleKeypress)
      eraseMenu()
      stdout.write(SHOW_CURSOR)
      stdin.pipe(inputStream)
      resolve(chosenIndex)
    }

    function handleKeypress(chunk: Buffer): void {
      const key = pendingEscape + chunk.toString('utf8')
      pendingEscape = ''
      clearEscapeTimer()

      if (key === ESCAPE_KEY) {
        pendingEscape = key
        escapeTimer = setTimeout(closeMenu, LONE_ESCAPE_CANCEL_MS, null)
        return
      }

      if (CONFIRM_KEYS.includes(key)) {
        closeMenu(selectedIndex)
        return
      }

      if (CANCEL_KEYS.includes(key)) {
        closeMenu(null)
        return
      }

      let nextIndex = selectedIndex
      if (MOVE_UP_KEYS.includes(key)) {
        nextIndex = (selectedIndex - 1 + choices.length) % choices.length
      }
      else if (MOVE_DOWN_KEYS.includes(key)) {
        nextIndex = (selectedIndex + 1) % choices.length
      }
      else {
        return
      }

      if (nextIndex !== selectedIndex) {
        selectedIndex = nextIndex
        eraseMenu()
        renderMenu(title, choices, selectedIndex)
      }
    }

    stdin.unpipe(inputStream)
    stdout.write(HIDE_CURSOR)
    renderMenu(title, choices, selectedIndex)
    stdin.on('data', handleKeypress)
    stdin.resume()
  })
}
