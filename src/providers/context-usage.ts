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
