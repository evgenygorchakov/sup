import type { Tool, ToolCall, ToolDefinition } from '../types.ts'

import { ledgerToolRegistered } from '../babysitter/ledger-tool.ts'
import { Config } from '../config.ts'
import { skills } from '../skills/registry.ts'
import { renderToolResult } from '../ui/interactive/render-tool-call.ts'
import { red } from '../utils/colors.ts'
import { editFile } from './list/edit-file.ts'
import { fetchUrl } from './list/fetch-url.ts'
import { glob } from './list/glob.ts'
import { grep } from './list/grep.ts'
import { ledgerUpdate } from './list/ledger-update.ts'
import { readFile } from './list/read-file.ts'
import { runShell } from './list/run-shell.ts'
import { skill } from './list/skill.ts'
import { webSearch } from './list/web-search.ts'
import { writeFile } from './list/write-file.ts'
import { validateArguments } from './validate-arguments.ts'

const allTools: Tool[] = [
  ...(Config.USE_SHELL_TOOL ? [runShell] : []),
  readFile,
  writeFile,
  editFile,
  grep,
  glob,
  webSearch,
  fetchUrl,
  ...(skills.length > 0 ? [skill] : []),
  ...(ledgerToolRegistered ? [ledgerUpdate] : []),
]

const availableTools: Tool[] = Config.USE_READ_ONLY_MODE
  ? allTools.filter(tool => !tool.mutates)
  : allTools

export const toolDefinitions: ToolDefinition[] = availableTools.map(tool => tool.definition)

export const autoApprovedToolDefinitions: ToolDefinition[] = availableTools
  .filter(tool => tool.autoApprove === true)
  .map(tool => tool.definition)

export const toolsByName: Record<string, Tool> = Object.fromEntries(
  availableTools.map(tool => [tool.definition.function.name, tool]),
)

export async function runTool(call: ToolCall): Promise<string> {
  const tool = toolsByName[call.function.name]
  if (!tool) {
    const message = `Unknown tool: ${call.function.name}. Available tools: ${Object.keys(toolsByName).join(', ')}.`
    console.error(red(`  ⎿  ${message}`))

    return message
  }

  const problem = validateArguments(tool.definition, call.function.arguments)
  if (problem) {
    console.error(red(`  ⎿  ${problem}`))

    return problem
  }

  const result = await tool
    .handler(call.function.arguments)
    .catch((error: Error) => `ERROR: ${error.message}`)

  console.error(renderToolResult(tool, call, result))

  return result
}
