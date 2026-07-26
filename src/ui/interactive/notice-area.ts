import type { EventEmitter } from 'node:events'
import type { PromptLineBuffer } from './below-cursor.ts'
import { paintBelowCursor } from './below-cursor.ts'

export interface NoticeArea {
  flash: (text: string) => void
  pin: (text: string) => void
  clear: () => void
}

export function createNoticeArea(inputStream: EventEmitter, readline: PromptLineBuffer): NoticeArea {
  let pinned: string | null = null
  let painted = false

  function paint(text: string | null): void {
    if (text) {
      paintBelowCursor(readline, `\r\n${text}`)
      painted = true
      return
    }
    if (painted) {
      paintBelowCursor(readline, '')
      painted = false
    }
  }

  inputStream.on('keypress', () => {
    paint(pinned)
  })

  return {
    flash(text) {
      paint(text)
    },
    pin(text) {
      pinned = text
      paint(text)
    },
    clear() {
      pinned = null
      paint(null)
    },
  }
}
