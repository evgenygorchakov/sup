#!/usr/bin/env node
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './src/providers/types.ts'
import type { Message } from './src/types.ts'

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process, { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { run } from './src/agent.ts'
import { getProvider } from './src/providers/index.ts'
import { initializeContextWindow } from './src/providers/ollama/context-window.ts'
import { SYSTEM_PROMPT } from './src/system-prompt.ts'
import { bold, brightGreen, gray } from './src/utils/colors.ts'

const EXIT_COMMANDS = new Set(['exit', 'quit', ':q'])
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

function loadEnvFileIfPresent(): void {
  try {
    process.loadEnvFile(resolve(PROJECT_ROOT, '.env'))
  }
  catch {
    // .env is optional — environment variables can be exported by the shell instead.
  }
}

const PROMPT_MARKER = bold(brightGreen('> '))

async function loadProjectInstructions(): Promise<string | null> {
  try {
    const filePath = resolve(process.cwd(), 'AGENTS.md')
    const fileContent = (await readFile(filePath, 'utf8')).trim()
    return fileContent || null
  }
  catch {
    return null
  }
}

async function handleUserTurn(provider: ChatProvider, messages: Message[], readline: ReadlineInterface, userInput: string): Promise<void> {
  messages.push({ role: 'user', content: userInput })
  await run(provider, messages, readline)
}

async function main() {
  loadEnvFileIfPresent()
  await initializeContextWindow()

  const provider = getProvider()
  const readline = createInterface({ input: stdin, output: stdout })

  process.once('SIGINT', () => {
    readline.close()
    process.exit(130)
  })

  const projectInstructions = await loadProjectInstructions()
  const systemContent = projectInstructions
    ? `${SYSTEM_PROMPT}\n\nProject instructions (from AGENTS.md):\n${projectInstructions}`
    : SYSTEM_PROMPT

  const messages: Message[] = [{ role: 'system', content: systemContent }]

  if (projectInstructions) {
    console.warn(gray('Loaded AGENTS.md'))
  }

  const commandLinePrompt = process.argv.slice(2).join(' ').trim()
  if (commandLinePrompt) {
    await handleUserTurn(provider, messages, readline, commandLinePrompt)
  }

  console.warn(gray('\nType "exit" or press Ctrl+D to quit.'))

  try {
    while (true) {
      let userInput: string

      try {
        userInput = (await readline.question(`\n${PROMPT_MARKER}`)).trim()
      }

      catch {
        break
      }

      if (!userInput) {
        continue
      }

      if (EXIT_COMMANDS.has(userInput.toLowerCase())) {
        break
      }

      await handleUserTurn(provider, messages, readline, userInput)
    }
  }
  finally {
    readline.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
