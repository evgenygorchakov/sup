#!/usr/bin/env node
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './src/providers/types.ts'
import type { Message } from './src/types.ts'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { run } from './src/agent.ts'
import { commands, runSlashCommand } from './src/commands/registry.ts'
import { isPlanModeActive } from './src/plan/mode-state.ts'
import { getProvider } from './src/providers/index.ts'
import { getContextWindowTokenLimit, getLastContextUsage, initializeContextWindow } from './src/providers/ollama/context-window.ts'
import { buildSkillsPromptSection, skills } from './src/skills/registry.ts'
import { SYSTEM_PROMPT } from './src/system-prompt.ts'
import { createSlashCompleter, installCommandHints } from './src/ui/interactive/command-hints.ts'
import { DISABLE_BRACKETED_PASTE, ENABLE_BRACKETED_PASTE, getInputStream, readUserInput } from './src/ui/interactive/multiline-input.ts'
import { bold, brightGreen, gray, red, yellow } from './src/utils/colors.ts'

const PROMPT_MARKER = bold(brightGreen('> '))

function planModeIndicator(): string {
  return isPlanModeActive() ? yellow('[plan] ') : ''
}

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

  const interactive = Boolean(stdin.isTTY)
  const inputStream = getInputStream()
  stdin.pipe(inputStream)
  const readline = createInterface({ input: inputStream, output: stdout, terminal: interactive, completer: createSlashCompleter(commands) })

  if (interactive) {
    stdin.setRawMode(true)
    stdout.write(ENABLE_BRACKETED_PASTE)
  }

  const commandHints = interactive
    ? installCommandHints(inputStream, readline as unknown as { line?: string, cursor?: number }, commands)
    : null

  let cleanedUp = false
  function cleanup(): void {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    if (interactive) {
      stdout.write(DISABLE_BRACKETED_PASTE)
      if (stdin.isTTY) {
        stdin.setRawMode(false)
      }
    }

    stdin.unpipe(inputStream)
    stdin.pause()
    readline.close()
  }

  readline.on('SIGINT', () => {
    cleanup()
    process.exit(130)
  })

  const projectInstructions = await loadProjectInstructions()
  const systemContent = [
    SYSTEM_PROMPT,
    buildSkillsPromptSection(),
    projectInstructions ? `Project instructions (from AGENTS.md):\n${projectInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: Message[] = [{ role: 'system', content: systemContent }]

  if (skills.length > 0) {
    console.warn(gray(`Loaded ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`))
  }
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

      commandHints?.setActive(true)
      try {
        userInput = (await readUserInput(readline, `\n${contextStatusLine()}${planModeIndicator()}${PROMPT_MARKER}`)).trim()
      }
      catch {
        break
      }
      finally {
        commandHints?.setActive(false)
      }

      if (!userInput) {
        continue
      }

      try {
        if (userInput.startsWith('/')) {
          const result = await runSlashCommand(userInput, { messages })
          if (result.kind === 'exit') {
            break
          }
          if (result.kind === 'run') {
            await run(provider, messages, readline, { skipPlanApproval: true })
          }
          continue
        }

        await handleUserTurn(provider, messages, readline, userInput)
      }
      catch (error) {
        console.error(red(`Error: ${error instanceof Error ? error.message : String(error)}`))
      }
    }
  }
  finally {
    cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
