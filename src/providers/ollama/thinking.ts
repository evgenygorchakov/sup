import { Config } from '../../config.ts'
import { gray } from '../../utils/colors.ts'

export type ThinkingMode = false | true | 'low' | 'medium' | 'high' | 'max'

const SHOW_REQUEST_TIMEOUT_MS = 10_000

/** Whether the model can think — asked once per model, never guessed from its name. */
export type ThinkingSupport = { supported: boolean } | { error: string }

const supportByModel = new Map<string, Promise<ThinkingSupport>>()
const warnedModels = new Set<string>()

function baseModelName(model: string): string {
  const colonIndex = model.indexOf(':')
  return colonIndex === -1 ? model : model.slice(0, colonIndex)
}

async function probeThinkingSupport(model: string): Promise<ThinkingSupport> {
  try {
    const response = await fetch(`${Config.OLLAMA_HOST}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(SHOW_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      return { error: `HTTP ${response.status}` }
    }

    const payload = await response.json() as { capabilities?: unknown }
    const capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : []
    return { supported: capabilities.includes('thinking') }
  }
  catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function getThinkingSupport(model: string): Promise<ThinkingSupport> {
  const cached = supportByModel.get(model)
  if (cached) {
    return await cached
  }

  const pending = probeThinkingSupport(model)
  supportByModel.set(model, pending)

  const support = await pending
  if ('error' in support) {
    supportByModel.delete(model)
  }
  return support
}

/** Thinking asked for but not happening is worth exactly one line, not one per request. */
function warnThinkingUnavailable(model: string, support: ThinkingSupport): void {
  if (warnedModels.has(model)) {
    return
  }

  warnedModels.add(model)
  console.warn(gray('error' in support
    ? `Could not check whether ${model} supports thinking (${support.error}); sending requests without it.`
    : `${model} reports no thinking capability, so thinking stays off — /thinking and OLLAMA_USE_THINKING have no effect for it.`))
}

export async function getThinkingModeFor(model: string): Promise<ThinkingMode> {
  if (!Config.OLLAMA_USE_THINKING) {
    return false
  }

  const support = await getThinkingSupport(model)
  if (!('supported' in support) || !support.supported) {
    warnThinkingUnavailable(model, support)
    return false
  }

  return baseModelName(model) === 'gpt-oss' ? 'max' : true
}
