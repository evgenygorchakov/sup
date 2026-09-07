import type { WebSearchResult } from './types.ts'

const SCHEME_PREFIX = /^[a-z][\w+.-]*:\/\//i
const LEADING_WWW = /^www\./

function normalizeDomain(raw: string): string {
  const host = raw.trim().toLowerCase().replace(SCHEME_PREFIX, '').split('/')[0] ?? ''

  return host.split(':')[0]?.replace(LEADING_WWW, '').replace(/^\.+|\.+$/g, '') ?? ''
}

export function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(entry => typeof entry === 'string')
    .map(entry => normalizeDomain(entry))
    .filter(domain => domain.length > 0)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(LEADING_WWW, '')
  }
  catch {
    return ''
  }
}

function covers(domain: string, host: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function filterByDomain(results: WebSearchResult[], allowed: string[], blocked: string[]): WebSearchResult[] {
  return results.filter((result) => {
    const host = hostOf(result.url)

    if (host.length === 0) {
      return allowed.length === 0
    }

    if (allowed.length > 0 && !allowed.some(domain => covers(domain, host))) {
      return false
    }

    return !blocked.some(domain => covers(domain, host))
  })
}

export function describeDomainFilter(allowed: string[], blocked: string[]): string {
  const parts: string[] = []

  if (allowed.length > 0) {
    parts.push(`only ${allowed.join(', ')}`)
  }
  if (blocked.length > 0) {
    parts.push(`without ${blocked.join(', ')}`)
  }

  return parts.join(', ')
}
