import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnvBoolean, getEnvNumber, getEnvString, loadEnvFile } from './utils/env.ts'

loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env'))

const THINKING_MODELS = new Set(['qwen3.5:35b', 'qwen3.6', 'qwen3.5:9b'])

export interface ConfigShape {
  PROVIDER: string
  HOST: string
  MODEL: string
  LANGUAGE: string
  USE_PLAN_MODE: boolean
  USE_READ_ONLY_MODE: boolean
  USE_SHELL_TOOL: boolean
  USE_NATIVE_OLLAMA_TOOLS: boolean
  CONTEXT_WINDOW_TOKEN_LIMIT: number
  OLLAMA_REQUEST_TIMEOUT_MS: number
  USE_THINKING: boolean
  SHOW_THINKING: boolean
  USE_STREAMING: boolean
  VERBOSE_TOOL_OUTPUT: boolean
  WEB_SEARCH_MAX_RESULTS: number
  FETCH_URL_MAX_BYTES: number
  FETCH_URL_TIMEOUT_MS: number
  USE_PERMISSION_ALLOWLIST: boolean
  USE_AUTONOMOUS_MODE: boolean
  AUTONOMOUS_STEP_BUDGET: number
  AUTONOMOUS_REPEAT_THRESHOLD: number
  AUTO_APPROVE_SHELL_PATTERNS: readonly RegExp[]
}

export const Config: ConfigShape = {
  PROVIDER: getEnvString('PROVIDER', 'ollama'),
  HOST: getEnvString('HOST', 'http://host.docker.internal:11434'),
  MODEL: getEnvString('MODEL', 'qwen3.6'),
  LANGUAGE: getEnvString('LANGUAGE', 'russian'),
  USE_PLAN_MODE: getEnvBoolean('USE_PLAN_MODE', false),
  USE_READ_ONLY_MODE: getEnvBoolean('USE_READ_ONLY_MODE', false),
  USE_SHELL_TOOL: getEnvBoolean('USE_SHELL_TOOL', false),
  USE_NATIVE_OLLAMA_TOOLS: getEnvBoolean('USE_NATIVE_OLLAMA_TOOLS', true),
  CONTEXT_WINDOW_TOKEN_LIMIT: getEnvNumber('CONTEXT_WINDOW_TOKEN_LIMIT', 80_000),
  OLLAMA_REQUEST_TIMEOUT_MS: getEnvNumber('OLLAMA_REQUEST_TIMEOUT_MS', 300_000),
  USE_THINKING: getEnvBoolean('USE_THINKING', true),
  SHOW_THINKING: getEnvBoolean('SHOW_THINKING', true),
  USE_STREAMING: getEnvBoolean('USE_STREAMING', true),
  VERBOSE_TOOL_OUTPUT: getEnvBoolean('VERBOSE_TOOL_OUTPUT', false),
  WEB_SEARCH_MAX_RESULTS: getEnvNumber('WEB_SEARCH_MAX_RESULTS', 5),
  FETCH_URL_MAX_BYTES: getEnvNumber('FETCH_URL_MAX_BYTES', 200_000),
  FETCH_URL_TIMEOUT_MS: getEnvNumber('FETCH_URL_TIMEOUT_MS', 15_000),
  USE_PERMISSION_ALLOWLIST: getEnvBoolean('USE_PERMISSION_ALLOWLIST', true),
  USE_AUTONOMOUS_MODE: getEnvBoolean('USE_AUTONOMOUS_MODE', true),
  AUTONOMOUS_STEP_BUDGET: getEnvNumber('AUTONOMOUS_STEP_BUDGET', 100),
  AUTONOMOUS_REPEAT_THRESHOLD: getEnvNumber('AUTONOMOUS_REPEAT_THRESHOLD', 3),
  AUTO_APPROVE_SHELL_PATTERNS: [
    // cat/head/tail/env deliberately excluded: they can dump sensitive files
    // or secrets from outside the working directory without confirmation.
    /^(ls|pwd|wc|file|stat|which|echo|date|uname|whoami|id|tree)(\s|$)/,
    /^git (status|diff|log|show|branch|remote|rev-parse|blame|ls-files)(\s|$)/,
    /^(node|tsc|eslint|npm|pnpm|yarn|deno|bun) --version$/,
  ],
}

export type ThinkingMode = false | true | 'low' | 'medium' | 'high'

function baseModelName(model: string): string {
  const colonIndex = model.indexOf(':')
  return colonIndex === -1 ? model : model.slice(0, colonIndex)
}

export function getThinkingModeFor(model: string): ThinkingMode {
  if (!Config.USE_THINKING) {
    return false
  }

  const baseName = baseModelName(model)

  if (baseName === 'gpt-oss') {
    return 'high'
  }

  return THINKING_MODELS.has(model) || THINKING_MODELS.has(baseName)
}
