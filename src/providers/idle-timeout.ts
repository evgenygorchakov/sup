// Aborts a fetch when the server goes quiet.
//
// A streaming completion can legitimately take minutes, so we can't cap total
// duration. Instead we watch for *inactivity*: the timer is armed on start and
// re-armed (refresh) on every chunk that arrives. If nothing arrives in time,
// the request is aborted. Callers check abortedByTimeout() to tell a genuine
// timeout apart from any other fetch failure.
//
// The wait splits into two phases, because a big local model is silent while it
// loads and prefills the prompt — no bytes arrive until the first token, which
// can take minutes. So the initial window (first chunk) is generous; once the
// stream starts, a tighter idle window catches a stall mid-reply quickly.
// abortedBeforeFirstChunk() reports which phase tripped so callers can explain.

export interface IdleTimeout {
  /** Pass to fetch() as its abort signal. */
  signal: AbortSignal
  /** Re-arm the timer; call whenever bytes arrive. */
  refresh: () => void
  /** Cancel the timer once the request is finished (success or failure). */
  stop: () => void
  /** True when the abort was triggered by the idle timer, not by the caller. */
  abortedByTimeout: () => boolean
  /** True when it timed out before any data arrived (slow first token). */
  abortedBeforeFirstChunk: () => boolean
}

export function startIdleTimeout(idleTimeoutMs: number, firstChunkTimeoutMs: number = idleTimeoutMs): IdleTimeout {
  const controller = new AbortController()
  let timedOut = false
  let firstChunkSeen = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (timeoutMs: number): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  const refresh = (): void => {
    firstChunkSeen = true
    arm(idleTimeoutMs)
  }

  arm(firstChunkTimeoutMs)

  return {
    signal: controller.signal,
    refresh,
    stop: () => clearTimeout(timer),
    abortedByTimeout: () => timedOut,
    abortedBeforeFirstChunk: () => timedOut && !firstChunkSeen,
  }
}
