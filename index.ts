#!/usr/bin/env node
import type { Interface as ReadlineInterface } from 'node:readline/promises'
import type { ChatProvider } from './src/providers/types.ts'
import type { Message } from './src/types.ts'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process, { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { run } from './src/agent.ts'
import { resumeIntoMessages } from './src/babysitter/index.ts'
import { parseArgs } from './src/cli/args.ts'
import { commands, runSlashCommand } from './src/commands/registry.ts'
import { Config } from './src/config.ts'
import { buildUserMessage } from './src/images/build-message.ts'
import { restorePendingImages } from './src/images/pending.ts'
import { recordUserMessage } from './src/journal/index.ts'
import { getMode } from './src/plan/mode-state.ts'
import { RequestCancelledError } from './src/providers/cancel.ts'
import { getLastContextUsage } from './src/providers/context-usage.ts'
import { getProvider, providerNames } from './src/providers/index.ts'
import { buildSkillsPromptSection, skills } from './src/skills/registry.ts'
import { SYSTEM_PROMPT } from './src/system-prompt.ts'
import { isSkipPermissionsActive, setSkipPermissions } from './src/tools/skip-permissions.ts'
import { createSlashCompleter, installCommandHints } from './src/ui/interactive/command-hints.ts'
import { installImagePasteHandler } from './src/ui/interactive/image-paste.ts'
import { installModeToggle } from './src/ui/interactive/mode-toggle.ts'
import { DISABLE_BRACKETED_PASTE, ENABLE_BRACKETED_PASTE, getInputStream, readUserInput } from './src/ui/interactive/multiline-input.ts'
import { bold, brightGreen, cyan, gray, red, yellow } from './src/utils/colors.ts'

const PROMPT_MARKER = bold(brightGreen('> '))

function modeIndicator(): string {
  const prefix = isSkipPermissionsActive() ? red('[skip-perms] ') : ''
  if (Config.USE_READ_ONLY_MODE) {
    return `${prefix}${gray('[read-only] ')}`
  }
  const mode = getMode()
  if (mode === 'plan') {
    return `${prefix}${yellow('[plan] ')}`
  }
  if (mode === 'auto') {
    return `${prefix}${cyan('[auto] ')}`
  }
  return prefix
}

function contextStatusLine(): string {
  const usage = getLastContextUsage()
  if (!usage) {
    return ''
  }

  const total = usage.prompt + usage.completion
  const limit = getProvider().getContextWindowTokenLimit()
  const percent = Math.round((total / limit) * 100)
  return gray(`[ctx: ${total} / ${limit} (${percent}%)]\n`)
}

function buildPrompt(): string {
  return `\n${contextStatusLine()}${modeIndicator()}${PROMPT_MARKER}`
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

const CANCELLED_NOTICE = yellow('\n⏹  Cancelled. Type your message again.')
const INTERRUPTED_NOTICE = yellow('\n⏹  Interrupted. The work so far is kept; type your next message.')

const INTERRUPTED_TURN_RECORD = 'Note: the user interrupted the previous turn (Esc) before it finished. Any tool calls shown above already ran and their results are final. Do not redo that work; continue from the user\'s next message.'

function noteInterruptedTurn(messages: Message[]): void {
  const notice: Message = { role: 'user', content: INTERRUPTED_TURN_RECORD }
  messages.push(notice)
  recordUserMessage(notice)
  console.warn(INTERRUPTED_NOTICE)
}

async function handleUserTurn(provider: ChatProvider, messages: Message[], readline: ReadlineInterface, userInput: string): Promise<void> {
  const mark = messages.length
  const message = await buildUserMessage(userInput)
  messages.push(message)
  const imageCount = message.images?.length ?? 0
  if (imageCount > 0) {
    console.warn(gray(`📎 Attached ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`))
  }
  try {
    await run(provider, messages, readline)
  }
  catch (error) {
    if (error instanceof RequestCancelledError) {
      if (messages.length > mark + 1) {
        noteInterruptedTurn(messages)
      }
      else {
        messages.length = mark
        if (message.images) {
          restorePendingImages(message.images)
        }
        console.warn(CANCELLED_NOTICE)
      }
      return
    }
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  setSkipPermissions(args.skipPermissions)
  if (args.provider !== undefined && !providerNames.includes(args.provider)) {
    console.error(red(`Unknown provider ${JSON.stringify(args.provider)}. Available: ${providerNames.join(', ')}`))
    process.exit(1)
  }
  Config.PROVIDER = args.provider ?? Config.PROVIDER
  const provider = getProvider()
  await provider.initializeContextWindow()

  const interactive = Boolean(stdin.isTTY)
  const inputStream = getInputStream()
  stdin.pipe(inputStream)
  const readline = createInterface({ input: inputStream, output: stdout, terminal: interactive, completer: createSlashCompleter(commands) })

  if (interactive) {
    stdin.setRawMode(true)
    stdout.write(ENABLE_BRACKETED_PASTE)
  }

  const imagePaste = interactive
    ? installImagePasteHandler(inputStream, readline)
    : null
  const commandHints = interactive
    ? installCommandHints(inputStream, readline as unknown as { line?: string, cursor?: number }, commands)
    : null
  const modeToggle = interactive
    ? installModeToggle(inputStream, readline, buildPrompt)
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
    projectInstructions ? `# Project instructions (from AGENTS.md)\n${projectInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const messages: Message[] = [{ role: 'system', content: systemContent }]

  console.warn(gray(`Provider: ${Config.PROVIDER}${Config.PROVIDER === 'llamacpp' ? '' : ` · Model: ${Config.MODEL}`}`))
  if (Config.USE_READ_ONLY_MODE) {
    console.warn(gray('Read-only session: write, edit, and shell tools are disabled.'))
  }
  if (isSkipPermissionsActive()) {
    console.warn(red('⚠  --dangerously-skip-permissions: all tool calls auto-approved without asking.'))
  }
  if (skills.length > 0) {
    console.warn(gray(`Loaded ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`))
  }
  if (projectInstructions) {
    console.warn(gray('Loaded AGENTS.md'))
  }

  if (args.resumeRequested) {
    const outcome = resumeIntoMessages(args.resumeRunId, messages)
    if (outcome.ok) {
      console.warn(gray(`Resumed run ${outcome.runId} (${outcome.restored} messages restored)`))
    }
    else if (outcome.reason === 'disabled') {
      console.warn(yellow('--resume requires USE_JOURNAL=true in your .env.'))
    }
    else {
      console.warn(yellow('Nothing to resume: no saved runs in this directory. Run a task here first.'))
    }
  }

  const commandLinePrompt = args.promptArgs.join(' ').trim()
  if (commandLinePrompt) {
    await handleUserTurn(provider, messages, readline, commandLinePrompt)
  }

  const planModeHint = interactive && !Config.USE_READ_ONLY_MODE ? ' Shift+Tab cycles modes: normal → auto → plan.' : ''
  console.warn(gray(`\nType /help for commands, /exit to quit.${planModeHint}`))

  try {
    while (true) {
      let userInput: string

      commandHints?.setActive(true)
      imagePaste?.setActive(true)
      modeToggle?.setActive(true)
      try {
        userInput = (await readUserInput(readline, buildPrompt())).trim()
      }
      catch {
        break
      }
      finally {
        commandHints?.setActive(false)
        imagePaste?.setActive(false)
        modeToggle?.setActive(false)
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
            const runMark = messages.length
            try {
              await run(provider, messages, readline, { skipPlanApproval: true })
            }
            catch (error) {
              if (!(error instanceof RequestCancelledError)) {
                throw error
              }
              if (messages.length > runMark) {
                noteInterruptedTurn(messages)
              }
              else {
                console.warn(CANCELLED_NOTICE)
              }
            }
          }
          continue
        }

        await handleUserTurn(provider, messages, readline, userInput)
      }
      catch (error) {
        if (error instanceof RequestCancelledError) {
          console.warn(CANCELLED_NOTICE)
        }
        else {
          console.error(red(`Error: ${error instanceof Error ? error.message : String(error)}`))
        }
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
