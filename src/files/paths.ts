import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

const WINDOWS_DRIVE_PATTERN = /^([A-Z]):[\\/]/i
const WSL_UNC_PATTERN = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+\\/i

function decodePercentEncoding(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

export function stripFileUri(raw: string): string {
  if (!/^file:\/\//i.test(raw)) {
    return raw
  }
  const withoutScheme = decodePercentEncoding(raw.replace(/^file:\/\/(?:localhost)?/i, ''))
  return /^\/[A-Z]:[\\/]/i.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir()
  }
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2))
  }
  return path
}

export function translateWslPath(path: string): string {
  const unc = WSL_UNC_PATTERN.exec(path)
  if (unc) {
    return `/${path.slice(unc[0].length).replace(/\\/g, '/')}`
  }
  const drive = WINDOWS_DRIVE_PATTERN.exec(path)
  if (!drive) {
    return path
  }
  const letter = drive[1]!.toLowerCase()
  const rest = path.slice(drive[0].length).replace(/\\/g, '/')
  return `/mnt/${letter}/${rest}`
}

function unescapeShellPath(path: string): string {
  return path.replace(/\\([ ()'"&!$`])/g, '$1')
}

/** Turns whatever the terminal produced on a drag-and-drop into an absolute local path. */
export function normalizePath(raw: string): string {
  // Quoting is part of what a drop produces, so it is stripped here rather than by every caller.
  const path = unescapeShellPath(expandHome(translateWslPath(stripFileUri(unquote(raw.trim())))))
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

export function unquote(token: string): string {
  const first = token[0]
  if ((first === '"' || first === '\'') && token.endsWith(first)) {
    return token.slice(1, -1)
  }

  return token
}

export function removeTokenWithSurroundingSpaces(text: string, token: string): string {
  const index = text.indexOf(token)
  if (index === -1) {
    return text
  }

  let start = index
  while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
    start--
  }
  let end = index + token.length
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) {
    end++
  }

  const midLine = start > 0 && end < text.length && text[start - 1] !== '\n' && text[end] !== '\n'
  return text.slice(0, start) + (midLine ? ' ' : '') + text.slice(end)
}

/** Paths inside the working directory are shown (and handed to the model) as ./relative ones. */
export function shortPath(path: string): string {
  const short = relative(process.cwd(), path)
  return short && !short.startsWith('..') ? `./${short}` : path
}
