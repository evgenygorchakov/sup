// Provider-agnostic, in-memory record of the most recent request's token usage.
// Each provider's chat call reports into here; the UI reads it for the status line.

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
