import { Config } from '../../config.ts'
import { getThinkingSupport } from '../../providers/ollama/thinking.ts'
import { createToggleCommand } from '../toggle.ts'

export const thinkingCommand = createToggleCommand({
  name: 'thinking',
  description: 'Toggle model thinking (Ollama only): /thinking opens a menu, or /thinking [on|off].',
  get: () => Config.OLLAMA_USE_THINKING,
  set: (value) => { Config.OLLAMA_USE_THINKING = value },
  unavailableReason: async () => {
    if (Config.PROVIDER !== 'ollama') {
      return 'Thinking for llama.cpp is set when launching llama-server; this toggle has no effect.'
    }

    // A model without the capability rejects thinking outright; do not offer a switch that does nothing.
    const support = await getThinkingSupport(Config.MODEL)
    return 'error' in support || support.supported
      ? undefined
      : `${Config.MODEL} reports no thinking capability; this toggle has no effect for it.`
  },
})
