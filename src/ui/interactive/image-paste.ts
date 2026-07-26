import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { NoticeArea } from './notice-area.ts'
import { readClipboardImage } from '../../images/clipboard.ts'
import { addPendingImage } from '../../images/pending.ts'
import { gray, yellow } from '../../utils/colors.ts'

export function installImagePasteHandler(
  inputStream: EventEmitter,
  readline: Pick<ReadlineInterface, 'write'>,
  notices: NoticeArea,
): { setActive: (value: boolean) => void } {
  let active = false
  let busy = false

  async function handlePaste(): Promise<void> {
    if (busy) {
      return
    }
    busy = true
    try {
      const image = await readClipboardImage()
      if (!image) {
        notices.flash(gray('No image in clipboard.'))
        return
      }
      const index = addPendingImage(image)
      readline.write(`[image #${index}] `)
    }
    catch {
      notices.flash(yellow('Could not read image from clipboard.'))
    }
    finally {
      busy = false
    }
  }

  inputStream.on('ctrl-v', () => {
    if (active) {
      void handlePaste()
    }
  })

  return {
    setActive(value) {
      active = value
      if (!active) {
        notices.clear()
      }
    },
  }
}
