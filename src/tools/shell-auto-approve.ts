import { Config } from '../config.ts'

const SHELL_METACHARACTERS_PATTERN = /[;|&<>`$\n]/

function containsShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTERS_PATTERN.test(command)
}

export function isShellCommandAutoApprovable(command: string): boolean {
  const trimmed = command.trim()
  if (containsShellMetacharacters(trimmed)) {
    return false
  }
  return Config.AUTO_APPROVE_SHELL_PATTERNS.some(pattern => pattern.test(trimmed))
}
