import { Config } from '../config.ts'

const SHELL_METACHARACTERS_PATTERN = /[;|&<>`$\n]/
const ABSOLUTE_OR_HOME_PATH_PATTERN = /(?:^|[\s"'=])[/~]/
const PARENT_TRAVERSAL_PATTERN = /(?:^|[/\s"'=])\.\.(?:$|[/\s"'=])/

export function containsShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTERS_PATTERN.test(command)
}

function referencesPathOutsideWorkingDirectory(command: string): boolean {
  return ABSOLUTE_OR_HOME_PATH_PATTERN.test(command) || PARENT_TRAVERSAL_PATTERN.test(command)
}

export function isShellCommandAutoApprovable(command: string): boolean {
  const trimmed = command.trim()
  if (containsShellMetacharacters(trimmed) || referencesPathOutsideWorkingDirectory(trimmed)) {
    return false
  }
  return Config.AUTO_APPROVE_SHELL_PATTERNS.some(pattern => pattern.test(trimmed))
}
