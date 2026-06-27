import type { Tool } from '../../types.ts'
import { readFile as readFromDisk } from 'node:fs/promises'
import { basename } from 'node:path'
import { green } from '../../utils/colors.ts'
import { isSensitiveFileName, OUTPUT_CHAR_LIMIT, resolveInsideWorkingDirectory } from './shared.ts'

const DEFAULT_LIMIT = 2000

export const readFile: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads a UTF-8 text file from disk. Returns numbered lines (1-indexed). Use offset and limit for large files. USE WHEN: you need to see a file\'s contents (this is the canonical replacement for cat/head/tail). DO NOT USE FOR: listing files (use glob), searching inside files (use grep), or running cat/head/tail through run_shell. EXAMPLE: {"path": "src/index.ts"} or for a large file {"path": "package-lock.json", "offset": 200, "limit": 100}.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file. Relative paths resolve from the current working directory.',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-indexed). Defaults to 1.',
          },
          limit: {
            type: 'number',
            description: `Maximum number of lines to return. Defaults to ${DEFAULT_LIMIT}.`,
          },
        },
        required: ['path'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { path?: unknown, offset?: unknown, limit?: unknown }
    const path = args.path
    const offsetInput = args.offset
    const limitInput = args.limit

    if (typeof path !== 'string') {
      return 'ERROR: read_file expects { path: string, offset?: number, limit?: number }'
    }

    const offset = typeof offsetInput === 'number' && offsetInput >= 1 ? Math.floor(offsetInput) : 1
    const limit = typeof limitInput === 'number' && limitInput >= 1 ? Math.floor(limitInput) : DEFAULT_LIMIT

    const resolved = await resolveInsideWorkingDirectory(path)
    if (!resolved.ok) {
      return `ERROR: ${resolved.error}`
    }

    if (isSensitiveFileName(basename(resolved.absolute))) {
      return `ERROR: refused to read sensitive file "${path}"`
    }

    let content: string

    try {
      content = await readFromDisk(resolved.absolute, 'utf8')
    }
    catch (error) {
      return `ERROR: ${(error as Error).message}`
    }

    const lines = content.split('\n')
    const start = offset - 1

    if (start >= lines.length) {
      return `File has ${lines.length} lines; offset ${offset} is past end.`
    }

    // Budget the output by character count, but one whole line at a time. Slicing
    // the joined text by characters (the old approach) cut mid-file while the
    // header still claimed "end of file" — two contradictory signals that left
    // the model unable to continue. Counting per line keeps lastShown honest, so
    // the header and offset-based pagination stay correct.
    const numbered: string[] = []
    let charCount = 0
    let index = start
    for (; index < lines.length && numbered.length < limit; index++) {
      let entry = `${String(index + 1).padStart(6, ' ')}\t${lines[index]}`
      // A single line longer than the whole budget would still blow the context,
      // so truncate that one line rather than refusing to show it.
      if (numbered.length === 0 && entry.length > OUTPUT_CHAR_LIMIT) {
        entry = `${entry.slice(0, OUTPUT_CHAR_LIMIT)} …[line truncated]`
      }
      else if (charCount + entry.length + 1 > OUTPUT_CHAR_LIMIT) {
        break
      }
      numbered.push(entry)
      charCount += entry.length + 1
    }

    const lastShown = start + numbered.length
    const remaining = lines.length - lastShown
    const body = numbered.join('\n')

    if (remaining === 0) {
      return `Showing lines ${offset}-${lastShown} of ${lines.length} (end of file):\n${body}`
    }

    const more = remaining === 1 ? '1 more line' : `${remaining} more lines`
    return `Showing lines ${offset}-${lastShown} of ${lines.length}:\n${body}\n…[output limit reached: ${more}; call read_file with offset ${lastShown + 1} to continue]`
  },
  primaryArgs: ['path', 'offset', 'limit'],
  accentColor: green,
  renderResult: (_args, result) => {
    const match = result.match(/^Showing lines (\d+)-(\d+) of (\d+)/)
    if (match) {
      const [, from, to, total] = match
      const remaining = Number(total) - Number(to)
      const more = remaining > 0 ? ` (+${remaining})` : ''
      return `Read lines ${from}–${to} of ${total}${more}`
    }

    return result
  },
  autoApprove: true,
}
