export interface ContextUsage {
  prompt: number
  completion: number
}

let lastContextUsage: ContextUsage | null = null

export function recordContextUsage(prompt: number, completion: number): void {
  lastContextUsage = { prompt, completion }
}

export function getLastContextUsage(): ContextUsage | null {
  return lastContextUsage
}

export function resetContextUsage(): void {
  lastContextUsage = null
}

export function reportContextUsage(promptTokens: unknown, completionTokens: unknown): void {
  if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
    recordContextUsage(promptTokens, completionTokens)
  }
}
