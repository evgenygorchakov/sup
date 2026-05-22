#!/usr/bin/env node
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './src/providers/types.ts'
import type { Message } from './src/types.ts'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { run } from './src/agent.ts'
import { runSlashCommand } from './src/commands.ts'
import { getProvider } from './src/providers/index.ts'
import { getContextWindowTokenLimit, getLastContextUsage, initializeContextWindow } from './src/providers/ollama/context-window.ts'
import { SYSTEM_PROMPT } from './src/system-prompt.ts'
import { bold, brightGreen, gray } from './src/utils/colors.ts'

const PROMPT_MARKER = bold(brightGreen('> '))

function contextStatusLine(): string {
  const usage = getLastContextUsage()
  if (!usage) {
    return ''
  }

  const total = usage.prompt + usage.completion
  const limit = getContextWindowTokenLimit()
  const percent = Math.round((total / limit) * 100)
  return gray(`[ctx: ${total} / ${limit} (${percent}%)]\n`)
}

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

  console.warn(gray('\nType /help for commands, /exit to quit.'))

  try {
    while (true) {
      let userInput: string

      try {
        userInput = (await readline.question(`\n${contextStatusLine()}${PROMPT_MARKER}`)).trim()
      }

      catch {
        break
      }

      if (!userInput) {
        continue
      }

      if (userInput.startsWith('/')) {
        if (runSlashCommand(userInput, { messages }).kind === 'exit') {
          break
        }
        continue
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
