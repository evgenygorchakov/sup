const DEFAULT_OLLAMA_PORT = '11434'
const LOOPBACK_HOSTNAME = '127.0.0.1'
const WILDCARD_HOSTNAMES = new Set(['0.0.0.0', '[::]'])
const EXPLICIT_PORT_PATTERN = /:\d+$/

function withSchemeAndPort(address: string): string {
  if (address.includes('://')) {
    return address
  }

  const [hostPort = '', ...pathParts] = address.split('/')
  const host = hostPort.startsWith(':') ? `${LOOPBACK_HOSTNAME}${hostPort}` : hostPort
  const port = EXPLICIT_PORT_PATTERN.test(host) ? '' : `:${DEFAULT_OLLAMA_PORT}`
  return `http://${host}${port}/${pathParts.join('/')}`
}

export function normalizeOllamaHost(raw: string): string {
  let url: URL
  try {
    url = new URL(withSchemeAndPort(raw.trim()))
  }
  catch {
    throw new TypeError(`Env variable OLLAMA_HOST is not a valid address: ${JSON.stringify(raw)}`)
  }

  if (WILDCARD_HOSTNAMES.has(url.hostname)) {
    url.hostname = LOOPBACK_HOSTNAME
  }
  return url.href.replace(/\/+$/, '')
}
