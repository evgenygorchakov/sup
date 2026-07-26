import { Config } from '../../config.ts'
import { getSpeaker } from '../../tts/speaker.ts'
import { createToggleCommand } from '../toggle.ts'

export const ttsCommand = createToggleCommand({
  name: 'tts',
  description: 'Toggle speaking answers out loud: /tts opens a menu, or /tts [on|off].',
  get: () => Config.USE_TTS,
  set: (value) => {
    Config.USE_TTS = value
    if (!value) {
      getSpeaker().stop()
    }
  },
})
