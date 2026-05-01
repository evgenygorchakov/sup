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
  buildIpv4Range('127.0.0.0', 8),
  buildIpv4Range('169.254.0.0', 16),
  buildIpv4Range('172.16.0.0', 12),
  buildIpv4Range('192.168.0.0', 16),
]

export function isPrivateHost(hostname: string): boolean {
  const lowered = hostname.toLowerCase()

  if (lowered === 'localhost' || lowered.endsWith('.localhost')) {
    return true
  }

  const ipVersion = isIP(hostname)

  if (ipVersion === 4) {
    const asInteger = parseIpv4Address(hostname)
    return PRIVATE_IPV4_RANGES.some(([rangeStart, rangeEnd]) => asInteger >= rangeStart && asInteger <= rangeEnd)
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
  }

  return false
}
