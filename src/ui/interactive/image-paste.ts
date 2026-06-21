// Wiring the Ctrl+V key (emitted by BracketedPasteTransform) to a clipboard
// read. On success the image is parked in the pending buffer and a visible
// "[image #N]" placeholder is typed into the current line; buildUserMessage
// drains the buffer when the line is submitted. Mirrors installCommandHints.

import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { stdout } from 'node:process'
import { Config } from '../../config.ts'
import { readClipboardImage } from '../../images/clipboard.ts'
import { addPendingImage } from '../../images/pending.ts'
import { gray, yellow } from '../../utils/colors.ts'

const SAVE_CURSOR = '\x1B7'
const RESTORE_CURSOR = '\x1B8'
const ERASE_BELOW_CURSOR = '\x1B[0J'

// A transient line shown below the prompt without moving the cursor off it.
function notice(text: string): void {
  stdout.write(`${SAVE_CURSOR}${ERASE_BELOW_CURSOR}\r\n${text}${RESTORE_CURSOR}`)
}

export function installImagePasteHandler(
  inputStream: EventEmitter,
  readline: Pick<ReadlineInterface, 'write'>,
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
        notice(gray('No image in clipboard.'))
        return
      }
      const index = addPendingImage(image)
      readline.write(`[image #${index}] `)
    }
    catch {
      notice(yellow('Could not read image from clipboard.'))
    }
    finally {
      busy = false
    }
  }

  inputStream.on('ctrl-v', () => {
    if (active && Config.USE_IMAGE_INPUT) {
      void handlePaste()
    }
  })

  return {
    setActive(value) {
      active = value
    },
  }
}
