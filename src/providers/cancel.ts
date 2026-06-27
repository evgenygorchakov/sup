// Thrown when the user interrupts an in-flight model request (Esc). Distinct
// from a real error so the agent loop can quietly rewind and return to the
// prompt instead of reporting a failure.

export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled by user')
    this.name = 'RequestCancelledError'
  }
}
