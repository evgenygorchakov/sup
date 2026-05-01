import type { ChatProvider } from './types.ts'
import { Config } from '../config.ts'
import { ollama } from './ollama/index.ts'

const providersByName: Record<string, ChatProvider> = { ollama }

export function getProvider(): ChatProvider {
  const providerName = Config.PROVIDER
  const provider = providersByName[providerName]

  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`)
  }

  return provider
}
