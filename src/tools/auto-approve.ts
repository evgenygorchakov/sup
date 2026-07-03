import type { ToolCall } from '../types.ts'

import { isAutoModeActive } from '../plan/mode-state.ts'
import { toolsByName } from './registry.ts'
import { isShellCommandAutoApprovable } from './shell-auto-approve.ts'
import { isSkipPermissionsActive } from './skip-permissions.ts'

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

export function shouldAutoApprove(call: ToolCall): boolean {
  if (isSkipPermissionsActive()) {
    return true
  }
  const tool = toolsByName[call.function.name]
  if (!tool) {
    return false
  }
  if (call.function.name === 'run_shell') {
    return canAutoApproveCall(call)
  }
  return tool.autoApprove === true || isAutoModeActive()
}
