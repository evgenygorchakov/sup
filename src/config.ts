import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getEnvBoolean, getEnvNumber, getEnvString, loadEnvFile } from './utils/env.ts'

loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env'))

export interface ConfigShape {
  PROVIDER: string
  OLLAMA_HOST: string
  OLLAMA_USE_THINKING: boolean
  LLAMACPP_HOST: string
  MODEL: string
  LANGUAGE: string
  USE_PLAN_MODE: boolean
  USE_AUTO_MODE: boolean
  USE_READ_ONLY_MODE: boolean
  USE_JOURNAL: boolean
  USE_SHELL_TOOL: boolean
  USE_NATIVE_TOOLS: boolean
  CONTEXT_WINDOW_TOKEN_LIMIT: number
  REQUEST_TIMEOUT_MS: number
  REQUEST_FIRST_TOKEN_TIMEOUT_MS: number
  TEMPERATURE: number
  MAX_RESPONSE_TOKENS: number
  REPEAT_PENALTY: number
  USE_LOOP_DETECTION: boolean
  THINKING_CHAR_LIMIT: number
  SHOW_THINKING: boolean
  USE_STREAMING: boolean
  VERBOSE_TOOL_OUTPUT: boolean
  WEB_SEARCH_MAX_RESULTS: number
  FETCH_URL_MAX_BYTES: number
  FETCH_URL_TIMEOUT_MS: number
  AUTONOMOUS_STEP_BUDGET: number
  AUTONOMOUS_REPEAT_THRESHOLD: number
  USE_TOOL_RESULT_COLLAPSE: boolean
  TOOL_RESULT_KEEP_RECENT: number
  TOOL_RESULT_COLLAPSE_MIN_CHARS: number
  TOOL_RESULT_COLLAPSE_BATCH: number
  AUTO_APPROVE_SHELL_PATTERNS: readonly RegExp[]
  USE_BABYSITTER: boolean
  BABYSITTER_VERIFICATION_GATE: boolean
  BABYSITTER_LEDGER: boolean
  BABYSITTER_GATED_SKILLS: boolean
  BABYSITTER_GATE_MAX_ATTEMPTS: number
  BABYSITTER_GATE_TIMEOUT_MS: number
}

export const Config: ConfigShape = {
  PROVIDER: getEnvString('PROVIDER', 'ollama'),
  OLLAMA_HOST: getEnvString('OLLAMA_HOST', 'http://host.docker.internal:11434'),
  OLLAMA_USE_THINKING: getEnvBoolean('OLLAMA_USE_THINKING', true),
  LLAMACPP_HOST: getEnvString('LLAMACPP_HOST', 'http://localhost:8080'),
  MODEL: getEnvString('MODEL', 'qwen3.6'),
  LANGUAGE: getEnvString('LANGUAGE', 'russian'),
  USE_PLAN_MODE: getEnvBoolean('USE_PLAN_MODE', false),
  USE_AUTO_MODE: getEnvBoolean('USE_AUTO_MODE', false),
  USE_READ_ONLY_MODE: process.argv.includes('--read-only') || getEnvBoolean('USE_READ_ONLY_MODE', false),
  USE_JOURNAL: getEnvBoolean('USE_JOURNAL', true),
  USE_SHELL_TOOL: getEnvBoolean('USE_SHELL_TOOL', true),
  USE_NATIVE_TOOLS: getEnvBoolean('USE_NATIVE_TOOLS', true),
  CONTEXT_WINDOW_TOKEN_LIMIT: getEnvNumber('CONTEXT_WINDOW_TOKEN_LIMIT', 80_000),
  REQUEST_TIMEOUT_MS: getEnvNumber('REQUEST_TIMEOUT_MS', 300_000),
  REQUEST_FIRST_TOKEN_TIMEOUT_MS: getEnvNumber('REQUEST_FIRST_TOKEN_TIMEOUT_MS', 600_000),
  TEMPERATURE: getEnvNumber('TEMPERATURE', 0.2),
  MAX_RESPONSE_TOKENS: getEnvNumber('MAX_RESPONSE_TOKENS', 8192),
  REPEAT_PENALTY: getEnvNumber('REPEAT_PENALTY', 1.1),
  USE_LOOP_DETECTION: getEnvBoolean('USE_LOOP_DETECTION', true),
  THINKING_CHAR_LIMIT: getEnvNumber('THINKING_CHAR_LIMIT', 30_000),
  SHOW_THINKING: getEnvBoolean('SHOW_THINKING', true),
  USE_STREAMING: getEnvBoolean('USE_STREAMING', true),
  VERBOSE_TOOL_OUTPUT: getEnvBoolean('VERBOSE_TOOL_OUTPUT', false),
  WEB_SEARCH_MAX_RESULTS: getEnvNumber('WEB_SEARCH_MAX_RESULTS', 5),
  FETCH_URL_MAX_BYTES: getEnvNumber('FETCH_URL_MAX_BYTES', 50_000),
  FETCH_URL_TIMEOUT_MS: getEnvNumber('FETCH_URL_TIMEOUT_MS', 15_000),
  AUTONOMOUS_STEP_BUDGET: getEnvNumber('AUTONOMOUS_STEP_BUDGET', 100),
  AUTONOMOUS_REPEAT_THRESHOLD: getEnvNumber('AUTONOMOUS_REPEAT_THRESHOLD', 3),
  USE_TOOL_RESULT_COLLAPSE: getEnvBoolean('USE_TOOL_RESULT_COLLAPSE', true),
  TOOL_RESULT_KEEP_RECENT: getEnvNumber('TOOL_RESULT_KEEP_RECENT', 8),
  TOOL_RESULT_COLLAPSE_MIN_CHARS: getEnvNumber('TOOL_RESULT_COLLAPSE_MIN_CHARS', 1500),
  TOOL_RESULT_COLLAPSE_BATCH: getEnvNumber('TOOL_RESULT_COLLAPSE_BATCH', 4),
  AUTO_APPROVE_SHELL_PATTERNS: [
    /^(ls|pwd|wc|file|stat|which|echo|date|uname|whoami|id|tree)(\s|$)/,
    /^git (status|diff|log|show|rev-parse|blame|ls-files)(\s|$)(?!.*--output)/,
    /^git (branch|remote)( (-v|-vv|-a|--all|--list))?$/,
    /^(node|tsc|eslint|npm|pnpm|yarn|deno|bun) --version$/,
  ],
  USE_BABYSITTER: getEnvBoolean('USE_BABYSITTER', false),
  BABYSITTER_VERIFICATION_GATE: getEnvBoolean('BABYSITTER_VERIFICATION_GATE', true),
  BABYSITTER_LEDGER: getEnvBoolean('BABYSITTER_LEDGER', true),
  BABYSITTER_GATED_SKILLS: getEnvBoolean('BABYSITTER_GATED_SKILLS', true),
  BABYSITTER_GATE_MAX_ATTEMPTS: getEnvNumber('BABYSITTER_GATE_MAX_ATTEMPTS', 3),
  BABYSITTER_GATE_TIMEOUT_MS: getEnvNumber('BABYSITTER_GATE_TIMEOUT_MS', 120_000),
}
