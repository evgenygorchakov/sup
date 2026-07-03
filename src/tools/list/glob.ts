import type { Tool } from '../../types.ts'
import { relative } from 'node:path'
import process from 'node:process'
import { green } from '../../utils/colors.ts'
import { resolveInsideWorkingDirectory, truncateText, walkFiles } from './shared.ts'

const PREVIEW_FILE_COUNT = 10

function globToRegex(glob: string): RegExp {
  let pattern = ''
  let index = 0

  while (index < glob.length) {
    const char = glob[index]!

    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          pattern += '(?:.*/)?'
          index += 3
          continue
        }
        pattern += '.*'
        index += 2
        continue
      }
      pattern += '[^/]*'
      index += 1
      continue
    }

    if (char === '?') {
      pattern += '[^/]'
      index += 1
      continue
    }

    if (char === '[') {
      const closeIndex = glob.indexOf(']', index + 1)
      if (closeIndex === -1) {
        pattern += '\\['
        index += 1
        continue
      }
      const body = glob.slice(index + 1, closeIndex)
      pattern += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`
      index = closeIndex + 1
      continue
    }

    if ('.+^${}()|\\'.includes(char)) {
      pattern += `\\${char}`
      index += 1
      continue
    }

    pattern += char
    index += 1
  }

  return new RegExp(`^${pattern}$`)
}

export const glob: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Finds files by glob pattern. Supports `*` (any chars except /), `**` (any chars including /), `?` (single char), and `[abc]` character classes. Returns file paths, one per line, relative to the current working directory. Skips .git, node_modules, dist, build, .next, out, coverage. Confined to the current working directory. USE WHEN: listing files by name, extension, or directory path. DO NOT USE FOR: searching file contents (use grep), reading a file (use read_file), or running find/ls through run_shell. EXAMPLE: {"pattern": "src/**/*.ts"} or {"pattern": "**/*.test.ts"}.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern matched against paths relative to the search root (e.g. "**/*.ts", "src/**/*.test.ts").',
          },
          path: {
            type: 'string',
            description: 'Directory to search in. Defaults to the current working directory.',
          },
        },
        required: ['pattern'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { pattern?: unknown, path?: unknown }
    const pattern = args.pattern
    const pathInput = typeof args.path === 'string' ? args.path : '.'

    if (typeof pattern !== 'string' || pattern.length === 0) {
      return 'ERROR: glob expects { pattern: string, path?: string }'
    }

    const resolved = await resolveInsideWorkingDirectory(pathInput)
    if (!resolved.ok) {
      return `ERROR: ${resolved.error}`
    }

    let regex: RegExp
    try {
      regex = globToRegex(pattern)
    }
    catch (error) {
      return `ERROR: invalid glob pattern: ${(error as Error).message}`
    }

    const workingDirectory = process.cwd()
    const matches: string[] = []

    for await (const file of walkFiles(resolved.absolute)) {
      const relativeToRoot = relative(resolved.absolute, file)
      if (regex.test(relativeToRoot)) {
        matches.push(relative(workingDirectory, file) || file)
      }
    }

    if (matches.length === 0) {
      return `No files match "${pattern}" in ${relative(workingDirectory, resolved.absolute) || '.'}`
    }

    matches.sort()

    return truncateText(matches.join('\n'))
  },
  primaryArgs: ['pattern', 'path'],
  accentColor: green,
  renderResult: (_args, result) => {
    if (result.startsWith('No files')) {
      const firstLineEnd = result.indexOf('\n')
      return firstLineEnd === -1 ? result : result.slice(0, firstLineEnd)
    }

    const lines = result.split('\n').filter(line => line.length > 0 && !line.startsWith('...['))
    const header = `Found ${lines.length} files`
    const preview = lines.slice(0, PREVIEW_FILE_COUNT).join('\n')
    const remainder = lines.length > PREVIEW_FILE_COUNT
      ? `\n… +${lines.length - PREVIEW_FILE_COUNT} more files`
      : ''

    return `${header}\n${preview}${remainder}`
  },
  autoApprove: true,
}
