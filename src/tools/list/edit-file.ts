import type { Tool } from '../../types.ts'
import { readFile as readFromDisk, writeFile as writeToDisk } from 'node:fs/promises'
import { blue } from '../../utils/colors.ts'
import { resolveInsideWorkingDirectory } from './shared.ts'

export const editFile: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edits a UTF-8 text file by replacing a single unique substring. The find string must appear exactly once in the file. Confined to the current working directory. USE WHEN: changing a small region of an existing file. INCLUDE 2-4 lines of surrounding context inside `find` so it matches exactly once; if the tool reports multiple matches, expand `find` with more context and retry. DO NOT USE FOR: creating new files (use write_file), replacing the whole file (use write_file with overwrite: true), or running sed/awk through run_shell. EXAMPLE: {"path": "src/config.ts", "find": "USE_THINKING: true", "replaceWith": "USE_THINKING: false"}.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file. Relative paths resolve from the current working directory.',
          },
          find: {
            type: 'string',
            description: 'Substring to find. Must be unique in the file and not empty. If a short find is ambiguous, include the line above and below it inside `find` (and mirror them inside `replaceWith`) to disambiguate.',
          },
          replaceWith: {
            type: 'string',
            description: 'String to replace the found substring with.',
          },
        },
        required: ['path', 'find', 'replaceWith'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { path?: unknown, find?: unknown, replaceWith?: unknown }
    const path = args.path
    const find = args.find
    const replaceWith = args.replaceWith

    if (typeof path !== 'string' || typeof find !== 'string' || typeof replaceWith !== 'string') {
      return 'ERROR: edit_file expects { path: string, find: string, replaceWith: string }'
    }

    if (find.length === 0) {
      return 'ERROR: find must not be empty'
    }

    const resolved = await resolveInsideWorkingDirectory(path)
    if (!resolved.ok) {
      return `ERROR: ${resolved.error}`
    }

    let content: string

    try {
      content = await readFromDisk(resolved.absolute, 'utf8')
    }
    catch (error) {
      return `ERROR: ${(error as Error).message}`
    }

    const occurrences = content.split(find).length - 1

    if (occurrences === 0) {
      return `ERROR: find not found in ${path}`
    }

    if (occurrences > 1) {
      return `ERROR: find matches ${occurrences} places in ${path}; make it unique by adding surrounding context`
    }

    const index = content.indexOf(find)
    const updated = content.slice(0, index) + replaceWith + content.slice(index + find.length)

    try {
      await writeToDisk(resolved.absolute, updated, 'utf8')
    }
    catch (error) {
      return `ERROR: ${(error as Error).message}`
    }

    return `Edited ${path}`
  },
  primaryArgs: ['path'],
  accentColor: blue,
  renderResult: (args, _result) => {
    const path = typeof args.path === 'string' ? args.path : '?'
    const find = typeof args.find === 'string' ? args.find : ''
    const replaceWith = typeof args.replaceWith === 'string' ? args.replaceWith : ''
    const minus = find.split('\n').map(line => `- ${line}`).join('\n')
    const plus = replaceWith.split('\n').map(line => `+ ${line}`).join('\n')

    return `Updated ${path}\n${minus}\n${plus}`
  },
}
