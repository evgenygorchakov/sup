export interface IdleTimeout {
  signal: AbortSignal
  refresh: () => void
  stop: () => void
  abortedByTimeout: () => boolean
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
