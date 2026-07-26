import type { EventEmitter } from 'node:events'
import { getSpeaker } from '../../tts/speaker.ts'

export function installSpeechEscape(inputStream: EventEmitter): void {
  inputStream.on('keypress', (_input: string, key?: { name?: string }) => {
    if (key?.name === 'escape') {
      getSpeaker().stop()
    }
  })
}
