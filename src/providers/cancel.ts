export class RequestCancelledError extends Error {
  constructor() {
    super('Request cancelled by user')
    this.name = 'RequestCancelledError'
  }
}
