import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { Config } from '../../config.ts'
import { initializeContextWindow } from '../../providers/ollama/context-window.ts'
import { listInstalledModels } from '../../providers/ollama/models.ts'
import { bold, brightGreen, gray, red } from '../../utils/colors.ts'

function normalizeModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`
}

async function run(context: CommandContext): Promise<CommandResult> {
  const result = await listInstalledModels()

  if (!result.ok) {
    console.warn(red(`Could not reach Ollama at ${Config.HOST}: ${result.error}.`))
    return { kind: 'continue' }
  }

  const { models } = result
  const current = normalizeModelName(Config.MODEL)
  const selector = context.args[0]

  if (!selector) {
    if (models.length === 0) {
      console.warn(gray('No models installed. Pull one with `ollama pull <name>`.'))
      return { kind: 'continue' }
    }

    console.warn(bold(brightGreen('\nInstalled models:')))
    models.forEach((model, index) => {
      const marker = normalizeModelName(model) === current ? brightGreen(' (current)') : ''
      console.warn(`  ${brightGreen(String(index + 1))}  ${model}${marker}`)
    })
    console.warn(gray('\nSwitch with /model <number|name>.'))
    return { kind: 'continue' }
  }

  const index = Number(selector)
  const lowered = selector.toLowerCase()
  const chosen = Number.isInteger(index) && index >= 1 && index <= models.length
    ? models[index - 1]
    : models.find(model => model === selector)
      ?? models.find(model => model.toLowerCase().includes(lowered))

  if (!chosen) {
    console.warn(red(`No model matching "${selector}". Type /model to list installed models.`))
    return { kind: 'continue' }
  }

  if (normalizeModelName(chosen) === current) {
    console.warn(gray(`Already using ${chosen}.`))
    return { kind: 'continue' }
  }

  Config.MODEL = chosen
  await initializeContextWindow()
  return { kind: 'continue' }
}

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'List installed models, or switch to one: /model [number|name].',
  run,
}
