import type { Tool } from '../../types.ts'
import { readFile as readFromDisk } from 'node:fs/promises'
import { basename } from 'node:path'
import { green } from '../../utils/colors.ts'
import { isSensitiveFileName, resolveInsideWorkingDirectory, truncateText } from './shared.ts'

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
    const chunk = lines.slice(offset - 1, offset - 1 + limit)

    if (chunk.length === 0) {
      return `File has ${lines.length} lines; offset ${offset} is past end.`
    }

    const lastShown = offset - 1 + chunk.length
    const numbered = chunk
      .map((line, index) => `${String(offset + index).padStart(6, ' ')}\t${line}`)
      .join('\n')

    const suffix = lastShown < lines.length ? '' : ' (end of file)'

    return `Showing lines ${offset}-${lastShown} of ${lines.length}${suffix}:\n${truncateText(numbered)}`
  },
  primaryArgs: ['path', 'offset', 'limit'],
  accentColor: green,
  renderResult: (_args, result) => {
    const match = result.match(/^Showing lines \d+-\d+ of (\d+)/)
    if (match) {
      return `Read ${match[1]} lines`
    }

    return result
  },
  autoApprove: true,
}
