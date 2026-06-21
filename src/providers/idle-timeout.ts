// Aborts a fetch when the server goes quiet.
//
// A streaming completion can legitimately take minutes, so we can't cap total
// duration. Instead we watch for *inactivity*: the timer is armed on start and
// re-armed (refresh) on every chunk that arrives. If nothing arrives for
// `timeoutMs`, the request is aborted. Callers check abortedByTimeout() to tell
// a genuine timeout apart from any other fetch failure.

export interface IdleTimeout {
  /** Pass to fetch() as its abort signal. */
  signal: AbortSignal
  /** Re-arm the timer; call whenever bytes arrive. */
  refresh: () => void
  /** Cancel the timer once the request is finished (success or failure). */
  stop: () => void
  /** True when the abort was triggered by the idle timer, not by the caller. */
  abortedByTimeout: () => boolean
}

export function startIdleTimeout(timeoutMs: number): IdleTimeout {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const refresh = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }

  refresh()

  return {
    signal: controller.signal,
    refresh,
    stop: () => clearTimeout(timer),
    abortedByTimeout: () => timedOut,
  }
}
