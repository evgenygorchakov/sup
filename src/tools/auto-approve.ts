import type { ToolCall } from '../types.ts'

import { Config } from '../config.ts'
import { toolsByName } from './registry.ts'

const SHELL_METACHARACTERS_PATTERN = /[;|&<>`$\n]/

function containsShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTERS_PATTERN.test(command)
}

function isShellCommandAutoApprovable(command: string): boolean {
  const trimmed = command.trim()
  if (containsShellMetacharacters(trimmed)) {
    return false
  }
  return Config.AUTO_APPROVE_SHELL_PATTERNS.some(pattern => pattern.test(trimmed))
}

export function canAutoApproveCall(call: ToolCall): boolean {
  const tool = toolsByName[call.function.name]
  if (!tool) {
    return false
  }
  if (tool.definition.function.name === 'run_shell') {
    const command = typeof call.function.arguments?.command === 'string'
      ? call.function.arguments.command
      : ''
    return isShellCommandAutoApprovable(command)
  }
  return tool.autoApprove === true
}
