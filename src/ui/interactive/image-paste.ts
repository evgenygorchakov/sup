import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { PromptLineBuffer } from './below-cursor.ts'
import { readClipboardImage } from '../../images/clipboard.ts'
import { addPendingImage } from '../../images/pending.ts'
import { gray, yellow } from '../../utils/colors.ts'
import { paintBelowCursor } from './below-cursor.ts'

export function installImagePasteHandler(
  inputStream: EventEmitter,
  readline: Pick<ReadlineInterface, 'write'> & PromptLineBuffer,
): { setActive: (value: boolean) => void } {
  let active = false
  let busy = false
  let noticeVisible = false

  function showNotice(text: string): void {
    paintBelowCursor(readline, `\r\n${text}`)
    noticeVisible = true
  }

  function eraseNotice(): void {
    if (noticeVisible) {
      paintBelowCursor(readline, '')
      noticeVisible = false
    }
  }

  async function handlePaste(): Promise<void> {
    if (busy) {
      return
    }
    busy = true
    try {
      const image = await readClipboardImage()
      if (!image) {
        showNotice(gray('No image in clipboard.'))
        return
      }
      const index = addPendingImage(image)
      readline.write(`[image #${index}] `)
    }
    catch {
      showNotice(yellow('Could not read image from clipboard.'))
    }
    finally {
      busy = false
    }
  }

  inputStream.on('keypress', () => {
    eraseNotice()
  })

  inputStream.on('ctrl-v', () => {
    if (active) {
      void handlePaste()
    }
  })

  return {
    setActive(value) {
      active = value
      if (!active) {
        eraseNotice()
      }
    },
  }
}
