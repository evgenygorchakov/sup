import type { Tool } from '../../types.ts'
import { Buffer } from 'node:buffer'
import { mkdir, stat, writeFile as writeToDisk } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { blue } from '../../utils/colors.ts'
import { isProtectedProjectPath, isSensitiveFileName, resolveInsideWorkingDirectory } from './shared.ts'

async function fileExists(absolute: string): Promise<boolean> {
  try {
    await stat(absolute)
    return true
  }
  catch {
    return false
  }
}

export const writeFile: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Writes UTF-8 text to a file. Creates missing parent directories. Refuses to overwrite existing files unless overwrite is true. Confined to the current working directory. USE WHEN: creating a new file, or replacing an entire existing file (with overwrite: true). DO NOT USE FOR: small targeted changes to an existing file (use edit_file), or running echo/heredoc/tee through run_shell. EXAMPLE: {"path": "src/notes.md", "content": "# Title\\nbody"}.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file. Relative paths resolve from the current working directory.',
          },
          content: {
            type: 'string',
            description: 'Full file content to write.',
          },
          overwrite: {
            type: 'boolean',
            description: 'Set to true to replace an existing file. Defaults to false.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const args = (rawArguments ?? {}) as { path?: unknown, content?: unknown, overwrite?: unknown }
    const path = args.path
    const content = args.content
    const overwrite = args.overwrite === true

    if (typeof path !== 'string') {
      return 'ERROR: write_file expects { path: string, content: string, overwrite?: boolean }'
    }

    if (typeof content !== 'string') {
      return 'ERROR: write_file expects content to be a string'
    }

    const resolved = await resolveInsideWorkingDirectory(path)
    if (!resolved.ok) {
      return `ERROR: ${resolved.error}`
    }

    if (isSensitiveFileName(basename(resolved.absolute))) {
      return `ERROR: refused to write sensitive file "${path}"`
    }

    if (await isProtectedProjectPath(resolved.absolute)) {
      return `ERROR: refused to write inside a protected directory (.git/.sup) "${path}"`
    }

    if (!overwrite && await fileExists(resolved.absolute)) {
      return `ERROR: file "${path}" already exists; pass overwrite: true to replace it`
    }

    try {
      await mkdir(dirname(resolved.absolute), { recursive: true })
      await writeToDisk(resolved.absolute, content, 'utf8')
    }
    catch (error) {
      return `ERROR: ${(error as Error).message}`
    }

    return `${overwrite ? 'Overwrote' : 'Wrote'} ${Buffer.byteLength(content, 'utf8')} bytes to ${path}`
  },
  primaryArgs: ['path', 'overwrite'],
  accentColor: blue,
}
