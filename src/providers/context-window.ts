import { Config } from '../config.ts'
import { gray, yellow } from '../utils/colors.ts'

const PROBE_REQUEST_TIMEOUT_MS = 10_000

export type ContextWindowProbeResult
  = | { detected: true, serverMax: number, banner: (detail: string) => string }
    | { detected: false, reason: string }

export type ContextWindowProbe = (signal: AbortSignal) => Promise<ContextWindowProbeResult>

interface ContextWindow {
  initializeContextWindow: () => Promise<void>
  getContextWindowTokenLimit: () => number
}

export function createContextWindow(probe: ContextWindowProbe, fallback: (reason: string) => string): ContextWindow {
  let resolvedTokenLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT

  function reportFallback(reason: string): void {
    console.warn(yellow(fallback(reason)))
  }

  async function initializeContextWindow(): Promise<void> {
    const userRequestedLimit = Config.CONTEXT_WINDOW_TOKEN_LIMIT
    resolvedTokenLimit = userRequestedLimit

    let result: ContextWindowProbeResult
    try {
      result = await probe(AbortSignal.timeout(PROBE_REQUEST_TIMEOUT_MS))
    }
    catch (error) {
      reportFallback(error instanceof Error ? error.message : String(error))
      return
    }

    if (!result.detected) {
      reportFallback(result.reason)
      return
    }

    const effectiveLimit = Math.min(userRequestedLimit, result.serverMax)
    resolvedTokenLimit = effectiveLimit

    console.warn(gray(result.banner(effectiveLimit === result.serverMax
      ? `${effectiveLimit} tokens`
      : `${effectiveLimit} of ${result.serverMax} tokens`)))
  }

  return { initializeContextWindow, getContextWindowTokenLimit: () => resolvedTokenLimit }
}
