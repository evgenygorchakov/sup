import { Config } from '../config.ts'
import { asUrl } from './text.ts'

export interface ClipboardSnippet {
  index: number
  kind: 'url' | 'text'
  content: string
  truncated: boolean
}

const MARKER_PATTERN = /[ \t]*\[clipboard #(\d+)[^\]]*\]/g
const MARKER_LABEL_LIMIT = 80

const pending: ClipboardSnippet[] = []
let lastAttached: string | null = null

/**
 * Queues clipboard content for the message being typed and hands back the snippet
 * whose marker goes into the line. Null when the same content was attached last time —
 * it is already in the conversation, so gluing it on again only burns context.
 */
export function addClipboardSnippet(rawContent: string): ClipboardSnippet | null {
  const content = rawContent.trim()
  if (!content || content === lastAttached) {
    return null
  }

  lastAttached = content
  const url = asUrl(content)
  const limit = Math.max(200, Config.CLIPBOARD_MAX_CHARS)
  const truncated = !url && content.length > limit

  const snippet: ClipboardSnippet = {
    index: pending.length + 1,
    kind: url ? 'url' : 'text',
    content: url ?? (truncated ? content.slice(0, limit) : content),
    truncated,
  }
  pending.push(snippet)
  return snippet
}

/** After a cancelled turn the content is out of the conversation again, so let it be attached anew. */
export function forgetLastClipboard(): void {
  lastAttached = null
}

export function markerFor(snippet: ClipboardSnippet): string {
  const label = snippet.kind === 'url'
    ? shorten(snippet.content)
    : `${snippet.content.length} chars${snippet.truncated ? ', truncated' : ''}`
  return `[clipboard #${snippet.index}: ${label}]`
}

/**
 * Replaces every `[clipboard #N]` marker left in the input with nothing and appends the
 * matching content as a block at the end. Deleting a marker before sending drops its content.
 */
export function expandClipboardMarkers(input: string): string {
  if (pending.length === 0) {
    return input
  }

  const used: ClipboardSnippet[] = []
  const text = input.replace(MARKER_PATTERN, (match, rawIndex: string) => {
    const snippet = pending[Number(rawIndex) - 1]
    if (!snippet || used.includes(snippet)) {
      return match
    }
    used.push(snippet)
    return ''
  })

  pending.length = 0
  if (used.length === 0) {
    return input
  }

  return [tidy(text), ...used.map(renderBlock)].filter(Boolean).join('\n\n')
}

function shorten(value: string): string {
  const flat = value.replace(/[\][]/g, '')
  return flat.length > MARKER_LABEL_LIMIT ? `${flat.slice(0, MARKER_LABEL_LIMIT - 1)}…` : flat
}

function renderBlock(snippet: ClipboardSnippet): string {
  if (snippet.kind === 'url') {
    return `URL from the clipboard: ${snippet.content}\nRead it with fetch_url and answer from what the page actually says. Never describe a page you have not fetched.`
  }

  const note = snippet.truncated ? ` (truncated to ${snippet.content.length} characters)` : ''
  return `Text from the clipboard${note}:\n"""\n${snippet.content}\n"""`
}

function tidy(text: string): string {
  return text.split('\n').map(line => line.trimEnd()).join('\n').trim()
}
