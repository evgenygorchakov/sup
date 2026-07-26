import type { EventEmitter } from 'node:events'
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { Dictation, Recording } from '../../stt/listener.ts'
import type { VoiceKeys } from './multiline-input.ts'
import type { NoticeArea } from './notice-area.ts'
import { Config } from '../../config.ts'
import { startRecording } from '../../stt/listener.ts'
import { getSpeaker } from '../../tts/speaker.ts'
import { gray, yellow } from '../../utils/colors.ts'
import { PASTE_PLACEHOLDER } from './multiline-input.ts'

const RECORDING_HINT = '🎤 Recording… Enter to send, Ctrl+G to insert without sending, Esc to cancel.'

export function installVoiceInput(
  inputStream: EventEmitter & VoiceKeys,
  readline: Pick<ReadlineInterface, 'write'>,
  notices: NoticeArea,
): { setActive: (value: boolean) => void } {
  let active = false
  let recording: Recording | null = null
  let busy = false
  let prompt = 0

  function reportAfterPrompt(dictation: Dictation): void {
    if (!dictation.ok) {
      console.warn(yellow(`Dictation failed: ${dictation.reason}`))
      return
    }
    if (dictation.text) {
      console.warn(gray(`Dictation finished after the prompt closed: ${dictation.text}`))
    }
  }

  async function transcribeInto(current: Recording, token: number, send: boolean): Promise<void> {
    busy = true
    try {
      notices.pin(gray('Transcribing…'))
      const dictation = await current.finish()
      if (token !== prompt) {
        reportAfterPrompt(dictation)
        return
      }
      notices.clear()
      if (!dictation.ok) {
        notices.flash(yellow(`Dictation failed: ${dictation.reason}`))
        return
      }
      if (!dictation.text) {
        notices.flash(gray('Nothing was picked up.'))
        return
      }
      readline.write(dictation.text.replace(/\r\n|\r|\n/g, PASTE_PLACEHOLDER))
      if (send) {
        inputStream.submitLine()
      }
    }
    finally {
      busy = false
    }
  }

  function stopRecording(send: boolean): void {
    const current = recording
    if (!current) {
      return
    }
    recording = null
    inputStream.setVoiceCapture(false)
    void transcribeInto(current, prompt, send).catch(() => {})
  }

  function dropRecording(): void {
    recording?.cancel()
    recording = null
    inputStream.setVoiceCapture(false)
  }

  inputStream.on('ctrl-g', () => {
    if (!active || busy) {
      return
    }
    if (!Config.USE_STT) {
      notices.flash(gray('Dictation is off — turn it on with /stt.'))
      return
    }

    if (recording) {
      stopRecording(false)
      return
    }

    getSpeaker().stop()
    recording = startRecording()
    inputStream.setVoiceCapture(true)
    notices.pin(yellow(RECORDING_HINT))
  })

  inputStream.on('voice-submit', () => {
    if (!active || busy) {
      return
    }
    stopRecording(true)
  })

  inputStream.on('voice-cancel', () => {
    if (!active || busy || !recording) {
      return
    }
    dropRecording()
    notices.clear()
    notices.flash(gray('Dictation cancelled.'))
  })

  return {
    setActive(value) {
      active = value
      if (!active) {
        prompt += 1
        dropRecording()
        notices.clear()
      }
    },
  }
}
