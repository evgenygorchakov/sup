export function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}
