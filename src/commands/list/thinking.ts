import { Config } from '../../config.ts'
import { createToggleCommand } from '../toggle.ts'

export const thinkingCommand = createToggleCommand({
  name: 'thinking',
  description: 'Toggle model thinking (Ollama only): /thinking opens a menu, or /thinking [on|off].',
  get: () => Config.OLLAMA_USE_THINKING,
  set: (value) => { Config.OLLAMA_USE_THINKING = value },
  unavailableReason: () =>
    Config.PROVIDER === 'ollama'
      ? undefined
      : 'Thinking for llama.cpp is set when launching llama-server; this toggle has no effect.',
})
