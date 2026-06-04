import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { Buffer } from 'node:buffer'
import { Transform } from 'node:stream'

export const PASTE_PLACEHOLDER = ''

export const ENABLE_BRACKETED_PASTE = '\x1B[?2004h'
export const DISABLE_BRACKETED_PASTE = '\x1B[?2004l'

const ESC = 0x1B
const NEWLINE = 0x0A
const CARRIAGE_RETURN = 0x0D
const PASTE_START = Buffer.from('\x1B[200~')
const PASTE_END = Buffer.from('\x1B[201~')
const PLACEHOLDER_BYTES = Buffer.from(PASTE_PLACEHOLDER)

export class BracketedPasteTransform extends Transform {
  private pending = Buffer.alloc(0)
  private inPaste = false

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
          if (!final) {
            break
          }
        }
        else if (buffer.subarray(index, index + marker.length).equals(marker)) {
          this.inPaste = !this.inPaste
          index += marker.length
          continue
        }
      }

      const byte = buffer[index]
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

export async function readUserInput(readline: ReadlineInterface, promptText: string): Promise<string> {
  const line = await readline.question(promptText)
  return line.split(PASTE_PLACEHOLDER).join('\n')
}
