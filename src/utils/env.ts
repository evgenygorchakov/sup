import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const KEY_PATTERN = /^[A-Z_]\w*$/i
const DOUBLE_QUOTED_ESCAPE_PATTERN = /\\(["\\nrt])/g
const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSY_VALUES = new Set(['false', '0', 'no', 'n', 'off', ''])

export function loadEnvFile(filePath: string = resolve(process.cwd(), '.env')): void {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  }
  catch {
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed
    const eqIndex = withoutExport.indexOf('=')
    if (eqIndex <= 0) {
      continue
    }

    const key = withoutExport.slice(0, eqIndex).trim()
    if (!KEY_PATTERN.test(key)) {
      continue
    }
    if (Object.hasOwn(process.env, key)) {
      continue
    }

    let value = withoutExport.slice(eqIndex + 1).trim()

    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(DOUBLE_QUOTED_ESCAPE_PATTERN, (_, ch: string) => {
        switch (ch) {
          case 'n': return '\n'
          case 'r': return '\r'
          case 't': return '\t'
          default: return ch
        }
      })
    }
    else if (value.length >= 2 && value.startsWith('\'') && value.endsWith('\'')) {
      value = value.slice(1, -1)
    }
    else {
      const inlineCommentIndex = value.indexOf(' #')
      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trim()
      }
    }

    process.env[key] = value
  }
}

export function isEnvSet(name: string): boolean {
  return process.env[name] !== undefined
}

export function getEnvString(name: string, defaultValue?: string): string {
  const raw = process.env[name]
  if (raw !== undefined && raw !== '') {
    return raw
  }
  if (defaultValue !== undefined) {
    return defaultValue
  }
  throw new Error(`Required env variable ${name} is not set`)
}

export function getEnvNumber(name: string, defaultValue?: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`Required env variable ${name} is not set`)
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Env variable ${name} is not a valid number: ${JSON.stringify(raw)}`)
  }
  return parsed
}

export function getEnvBoolean(name: string, defaultValue?: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`Required env variable ${name} is not set`)
  }

  const normalized = raw.trim().toLowerCase()
  if (TRUTHY_VALUES.has(normalized)) {
    return true
  }
  if (FALSY_VALUES.has(normalized)) {
    return false
  }
  throw new TypeError(`Env variable ${name} is not a valid boolean: ${JSON.stringify(raw)}`)
}
