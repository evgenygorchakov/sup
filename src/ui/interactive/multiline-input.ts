import type { Interface as ReadlineInterface } from 'node:readline/promises'
import { Buffer } from 'node:buffer'
import { Transform } from 'node:stream'

export const PASTE_PLACEHOLDER = '\uE000'

export const ENABLE_BRACKETED_PASTE = '\x1B[?2004h'
export const DISABLE_BRACKETED_PASTE = '\x1B[?2004l'

const ESC = 0x1B
const NEWLINE = 0x0A
const CARRIAGE_RETURN = 0x0D
const CTRL_V = 0x16
const CTRL_G = 0x07
const CTRL_C = 0x03
const CTRL_D = 0x04
const PASTE_START = Buffer.from('\x1B[200~')
const PASTE_END = Buffer.from('\x1B[201~')
const SHIFT_TAB = Buffer.from('\x1B[Z')
const PLACEHOLDER_BYTES = Buffer.from(PASTE_PLACEHOLDER)

const SPACE = 0x20
const TAB = 0x09
const CSI_INTRODUCER = 0x5B
const SS3_INTRODUCER = 0x4F

const PARTIAL_ESCAPE_FLUSH_MS = 50

function matchSequence(buffer: Buffer, index: number, seq: Buffer, final: boolean): 'full' | 'partial' | 'none' {
  const available = buffer.length - index
  if (available >= seq.length) {
    return buffer.subarray(index, index + seq.length).equals(seq) ? 'full' : 'none'
  }
  if (!final && seq.subarray(0, available).equals(buffer.subarray(index))) {
    return 'partial'
  }
  return 'none'
}

export interface VoiceKeys {
  setVoiceCapture: (value: boolean) => void
  submitLine: () => void
}

export class BracketedPasteTransform extends Transform implements VoiceKeys {
  private pending = Buffer.alloc(0)
  private inPaste = false
  private pasteHadContent = false
  private pasteHoldback: Buffer[] = []
  private partialEscapeTimer: NodeJS.Timeout | null = null
  private voiceCapture = false

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.pending = Buffer.concat([this.pending, chunk])
    this.consume(false)
    this.schedulePartialEscapeFlush()
    done()
  }

  override _flush(done: () => void): void {
    this.flushPending()
    done()
  }

  resetPending(): void {
    this.clearPartialEscapeFlush()
    this.pending = Buffer.alloc(0)
    this.inPaste = false
    this.pasteHadContent = false
    this.pasteHoldback = []
  }

  setVoiceCapture(value: boolean): void {
    this.voiceCapture = value
  }

  submitLine(): void {
    this.push(Buffer.from('\r'))
  }

  private schedulePartialEscapeFlush(): void {
    this.clearPartialEscapeFlush()
    if (this.inPaste || this.pending.length === 0 || this.pending[0] !== ESC) {
      return
    }
    this.partialEscapeTimer = setTimeout(() => {
      this.partialEscapeTimer = null
      if (!this.destroyed) {
        this.flushPending()
      }
    }, PARTIAL_ESCAPE_FLUSH_MS)
    this.partialEscapeTimer.unref()
  }

  private clearPartialEscapeFlush(): void {
    if (this.partialEscapeTimer) {
      clearTimeout(this.partialEscapeTimer)
      this.partialEscapeTimer = null
    }
  }

  private flushPending(): void {
    this.clearPartialEscapeFlush()
    this.consume(true)
    const leftover = Buffer.concat([...this.pasteHoldback, this.pending])
    this.pasteHoldback = []
    this.pending = Buffer.alloc(0)
    if (leftover.length > 0) {
      this.push(leftover)
    }
  }

  private collectPasteOutput(output: Buffer[], bytes: Buffer, countsAsContent: boolean): void {
    if (this.pasteHadContent) {
      output.push(bytes)
      return
    }
    if (countsAsContent) {
      this.pasteHadContent = true
      output.push(...this.pasteHoldback, bytes)
      this.pasteHoldback = []
      return
    }
    this.pasteHoldback.push(bytes)
  }

  private consumeVoiceKey(buffer: Buffer, index: number, final: boolean): number {
    const byte = buffer[index]
    if (byte === CTRL_G) {
      this.emit('ctrl-g')
      return 1
    }
    if (byte === NEWLINE || byte === CARRIAGE_RETURN) {
      this.emit('voice-submit')
      return 1
    }
    if (byte === ESC) {
      const nothingFollows = index + 1 >= buffer.length
      if (nothingFollows && !final) {
        return 0
      }
      const follower = buffer[index + 1]
      if (nothingFollows || (follower !== CSI_INTRODUCER && follower !== SS3_INTRODUCER)) {
        this.emit('voice-cancel')
      }
      return 1
    }
    return 1
  }

  private consume(final: boolean): void {
    const buffer = this.pending
    const output: Buffer[] = []
    let index = 0

    while (index < buffer.length) {
      if (this.voiceCapture && (buffer[index] === CTRL_C || buffer[index] === CTRL_D)) {
        this.emit('voice-cancel')
      }

      if (this.voiceCapture) {
        const consumed = this.consumeVoiceKey(buffer, index, final)
        if (consumed === 0) {
          break
        }
        index += consumed
        continue
      }

      if (buffer[index] === ESC) {
        if (!this.inPaste) {
          const shiftTab = matchSequence(buffer, index, SHIFT_TAB, final)
          if (shiftTab === 'partial') {
            break
          }
          if (shiftTab === 'full') {
            this.emit('shift-tab')
            index += SHIFT_TAB.length
            continue
          }
        }

        const marker = this.inPaste ? PASTE_END : PASTE_START
        const markerMatch = matchSequence(buffer, index, marker, final)
        if (markerMatch === 'partial') {
          break
        }
        if (markerMatch === 'full') {
          const enteringPaste = !this.inPaste
          this.inPaste = enteringPaste
          if (enteringPaste) {
            this.pasteHadContent = false
            this.pasteHoldback = []
          }
          else if (!this.pasteHadContent) {
            this.pasteHoldback = []
            this.emit('ctrl-v')
          }
          index += marker.length
          continue
        }
      }

      const byte = buffer[index]
      if (!this.inPaste && byte === CTRL_V) {
        this.emit('ctrl-v')
        index++
        continue
      }
      if (!this.inPaste && byte === CTRL_G) {
        this.emit('ctrl-g')
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
        this.collectPasteOutput(output, PLACEHOLDER_BYTES, false)
      }
      else if (this.inPaste) {
        this.collectPasteOutput(output, buffer.subarray(index, index + 1), byte !== SPACE && byte !== TAB)
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

let sharedInputStream: BracketedPasteTransform | null = null

export function getInputStream(): BracketedPasteTransform {
  sharedInputStream ??= new BracketedPasteTransform()
  return sharedInputStream
}

export async function readUserInput(readline: ReadlineInterface, promptText: string): Promise<string> {
  const line = await readline.question(promptText)
  return line.split(PASTE_PLACEHOLDER).join('\n')
}
