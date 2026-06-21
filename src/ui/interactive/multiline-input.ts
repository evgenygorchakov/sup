import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { Buffer } from 'node:buffer'
import { Transform } from 'node:stream'

// U+E000 (private use): stands in for newlines inside a paste so readline
// sees a single line; readUserInput converts it back to '\n'.
export const PASTE_PLACEHOLDER = '\uE000'

export const ENABLE_BRACKETED_PASTE = '\x1B[?2004h'
export const DISABLE_BRACKETED_PASTE = '\x1B[?2004l'

const ESC = 0x1B
const NEWLINE = 0x0A
const CARRIAGE_RETURN = 0x0D
const CTRL_V = 0x16
const PASTE_START = Buffer.from('\x1B[200~')
const PASTE_END = Buffer.from('\x1B[201~')
const PLACEHOLDER_BYTES = Buffer.from(PASTE_PLACEHOLDER)

const SPACE = 0x20
const TAB = 0x09

export class BracketedPasteTransform extends Transform {
  private pending = Buffer.alloc(0)
  private inPaste = false
  private pasteHadContent = false

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.pending = Buffer.concat([this.pending, chunk])
    this.consume(false)
    done()
  }

  override _flush(done: () => void): void {
    this.consume(true)
    if (this.pending.length > 0) {
      this.push(this.pending)
      this.pending = Buffer.alloc(0)
    }
    done()
  }

  private consume(final: boolean): void {
    const buffer = this.pending
    const output: Buffer[] = []
    let index = 0

    while (index < buffer.length) {
      const marker = this.inPaste ? PASTE_END : PASTE_START

      if (buffer[index] === ESC) {
        if (index + marker.length > buffer.length) {
          if (!final && marker.subarray(0, buffer.length - index).equals(buffer.subarray(index))) {
            break
          }
        }
        else if (buffer.subarray(index, index + marker.length).equals(marker)) {
          const enteringPaste = !this.inPaste
          this.inPaste = enteringPaste
          // An empty paste (no real characters) is how some terminals — notably
          // Windows Terminal on WSL — surface Ctrl+V of an image, which has no
          // text form. Treat it as an image-paste request too.
          if (enteringPaste) {
            this.pasteHadContent = false
          }
          else if (!this.pasteHadContent) {
            this.emit('ctrl-v')
          }
          index += marker.length
          continue
        }
      }

      const byte = buffer[index]
      // Ctrl+V outside a paste means "paste an image from the clipboard": swallow
      // the byte (so readline never inserts ^V) and let a listener handle it.
      if (!this.inPaste && byte === CTRL_V) {
        this.emit('ctrl-v')
        index++
        continue
      }
      if (this.inPaste && (byte === NEWLINE || byte === CARRIAGE_RETURN)) {
        if (byte === CARRIAGE_RETURN) {
          if (index + 1 >= buffer.length && !final) {
            break
          }
          if (buffer[index + 1] === NEWLINE) {
            index++
          }
        }
        output.push(PLACEHOLDER_BYTES)
      }
      else {
        if (this.inPaste && byte !== SPACE && byte !== TAB) {
          this.pasteHadContent = true
        }
        output.push(buffer.subarray(index, index + 1))
      }
      index++
    }

    this.pending = buffer.subarray(index)
    if (output.length > 0) {
      this.push(Buffer.concat(output))
    }
  }
}

let sharedInputStream: BracketedPasteTransform | null = null

export function getInputStream(): BracketedPasteTransform {
  sharedInputStream ??= new BracketedPasteTransform()
  return sharedInputStream
}

export async function readUserInput(readline: ReadlineInterface, promptText: string): Promise<string> {
  const line = await readline.question(promptText)
  return line.split(PASTE_PLACEHOLDER).join('\n')
}
