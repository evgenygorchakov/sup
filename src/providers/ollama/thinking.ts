import { Config } from '../../config.ts'

export type ThinkingMode = false | true | 'low' | 'medium' | 'high' | 'max'

const THINKING_MODELS = new Set(['qwen3.5:35b', 'qwen3.6', 'qwen3.5:9b'])

function baseModelName(model: string): string {
  const colonIndex = model.indexOf(':')
  return colonIndex === -1 ? model : model.slice(0, colonIndex)
}

export function getThinkingModeFor(model: string): ThinkingMode {
  if (!Config.OLLAMA_USE_THINKING) {
    return false
  }

  const baseName = baseModelName(model)

  if (baseName === 'gpt-oss') {
    return 'max'
  }

  return THINKING_MODELS.has(model) || THINKING_MODELS.has(baseName)
}
