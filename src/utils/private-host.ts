import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function parseIpv4Address(address: string): number {
  const parts = address.split('.').map(Number)
  return parts[0]! * 0x01000000 + parts[1]! * 0x010000 + parts[2]! * 0x0100 + parts[3]!
}

function buildIpv4Range(baseAddress: string, prefixBits: number): [number, number] {
  const baseValue = parseIpv4Address(baseAddress)
  const rangeSize = 2 ** (32 - prefixBits)

  return [baseValue, baseValue + rangeSize - 1]
}

const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  buildIpv4Range('0.0.0.0', 8),
  buildIpv4Range('10.0.0.0', 8),
  buildIpv4Range('100.64.0.0', 10),
  buildIpv4Range('127.0.0.0', 8),
  buildIpv4Range('169.254.0.0', 16),
  buildIpv4Range('172.16.0.0', 12),
  buildIpv4Range('192.0.0.0', 24),
  buildIpv4Range('192.168.0.0', 16),
  buildIpv4Range('198.18.0.0', 15),
  buildIpv4Range('224.0.0.0', 4),
  buildIpv4Range('240.0.0.0', 4),
]

const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i
const IPV4_MAPPED_IPV6_HEX_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i

function isPrivateIpv4(address: string): boolean {
  const asInteger = parseIpv4Address(address)
  return PRIVATE_IPV4_RANGES.some(([rangeStart, rangeEnd]) => asInteger >= rangeStart && asInteger <= rangeEnd)
}

function mappedHexToIpv4(highWord: string, lowWord: string): string {
  const high = Number.parseInt(highWord, 16)
  const low = Number.parseInt(lowWord, 16)
  return `${high >> 8}.${high & 0xFF}.${low >> 8}.${low & 0xFF}`
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

export function isPrivateHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase()

  if (lowered === 'localhost' || lowered.endsWith('.localhost')) {
    return true
  }

  const ipVersion = isIP(hostname)

  if (ipVersion === 4) {
    return isPrivateIpv4(hostname)
  }

  if (ipVersion === 6) {
    if (lowered === '::1' || lowered === '::') {
      return true
    }

    if (lowered.startsWith('fc') || lowered.startsWith('fd')) {
      return true
    }

    if (/^fe[89ab][0-9a-f]?:/.test(lowered)) {
      return true
    }

    const mapped = lowered.match(IPV4_MAPPED_IPV6_PATTERN)
    if (mapped && isPrivateIpv4(mapped[1]!)) {
      return true
    }

    const mappedHex = lowered.match(IPV4_MAPPED_IPV6_HEX_PATTERN)
    if (mappedHex && isPrivateIpv4(mappedHexToIpv4(mappedHex[1]!, mappedHex[2]!))) {
      return true
    }
  }

  return false
}

export type HostCheck = | { ok: true, addresses: string[] } | { ok: false, error: string }

export async function resolveAndCheckPublicHost(hostname: string): Promise<HostCheck> {
  const bareHost = stripIpv6Brackets(hostname)

  if (isPrivateHost(bareHost)) {
    return { ok: false, error: `host ${hostname} is on the private/local network` }
  }

  if (isIP(bareHost)) {
    return { ok: true, addresses: [bareHost] }
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(bareHost, { all: true, verbatim: true })
  }
  catch (error) {
    return { ok: false, error: `DNS lookup failed for ${hostname}: ${(error as Error).message}` }
  }

  for (const entry of addresses) {
    if (isPrivateHost(entry.address)) {
      return { ok: false, error: `host ${hostname} resolves to private address ${entry.address}` }
    }
  }

  if (addresses.length === 0) {
    return { ok: false, error: `DNS lookup returned no addresses for ${hostname}` }
  }

  return { ok: true, addresses: addresses.map(entry => entry.address) }
}
