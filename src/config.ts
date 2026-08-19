import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getEnvBoolean, getEnvNumber, getEnvString, loadEnvFile } from './utils/env.ts'

const installDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

loadEnvFile(resolve(installDir, '.env'))

export interface ConfigShape {
  PROVIDER: string
  OLLAMA_HOST: string
  OLLAMA_USE_THINKING: boolean
  LLAMACPP_HOST: string
  MODEL: string
  LANGUAGE: string
  REPLY_STYLE_SHORT: boolean
  USE_CLAUDE_SKILLS: boolean
  USE_PLAN_MODE: boolean
  USE_AUTO_MODE: boolean
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
  USE_TTS: boolean
  TTS_HOST: string
  TTS_VOICE: string
  TTS_RATE: string
  TTS_TIMEOUT_MS: number
  USE_STT: boolean
  STT_HOST: string
  STT_DEVICE: string
  STT_TIMEOUT_MS: number
  USE_DICTATION_CLIPBOARD: boolean
  CLIPBOARD_MAX_CHARS: number
  USE_PDF_CONVERT: boolean
  PDF_CONVERTER: string
  PDF_TIMEOUT_MS: number
  PDF_EXTRACT_IMAGES: boolean
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
  // Empty means: ask the provider at startup (see resolveStartupModel in index.ts).
  MODEL: getEnvString('MODEL', ''),
  LANGUAGE: getEnvString('LANGUAGE', 'russian'),
  REPLY_STYLE_SHORT: getEnvBoolean('REPLY_STYLE_SHORT', true),
  USE_CLAUDE_SKILLS: getEnvBoolean('USE_CLAUDE_SKILLS', false),
  USE_PLAN_MODE: getEnvBoolean('USE_PLAN_MODE', false),
  USE_AUTO_MODE: getEnvBoolean('USE_AUTO_MODE', true),
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
  USE_TTS: getEnvBoolean('USE_TTS', false),
  TTS_HOST: getEnvString('TTS_HOST', 'http://127.0.0.1:5011'),
  TTS_VOICE: getEnvString('TTS_VOICE', ''),
  TTS_RATE: getEnvString('TTS_RATE', 'medium'),
  TTS_TIMEOUT_MS: getEnvNumber('TTS_TIMEOUT_MS', 30_000),
  USE_STT: getEnvBoolean('USE_STT', true),
  STT_HOST: getEnvString('STT_HOST', 'http://127.0.0.1:5001'),
  STT_DEVICE: getEnvString('STT_DEVICE', ''),
  STT_TIMEOUT_MS: getEnvNumber('STT_TIMEOUT_MS', 120_000),
  USE_DICTATION_CLIPBOARD: getEnvBoolean('USE_DICTATION_CLIPBOARD', true),
  CLIPBOARD_MAX_CHARS: getEnvNumber('CLIPBOARD_MAX_CHARS', 20_000),
  USE_PDF_CONVERT: getEnvBoolean('USE_PDF_CONVERT', true),
  PDF_CONVERTER: getEnvString('PDF_CONVERTER', 'pdf-to-md'),
  // Generous: the converter has no daemon, so every file pays for loading the models again.
  PDF_TIMEOUT_MS: getEnvNumber('PDF_TIMEOUT_MS', 900_000),
  PDF_EXTRACT_IMAGES: getEnvBoolean('PDF_EXTRACT_IMAGES', false),
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
