import type { SelectChoice } from '../../ui/interactive/select.ts'
import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { stdin } from 'node:process'
import { Config } from '../../config.ts'
import { initializeContextWindow } from '../../providers/ollama/context-window.ts'
import { listInstalledModels } from '../../providers/ollama/models.ts'
import { selectFromList } from '../../ui/interactive/select.ts'
import { bold, brightGreen, gray, red } from '../../utils/colors.ts'

function normalizeModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`
}

function isCurrentModel(model: string): boolean {
  return normalizeModelName(model) === normalizeModelName(Config.MODEL)
}

async function loadInstalledModels(): Promise<string[] | null> {
  const result = await listInstalledModels()

  if (!result.ok) {
    console.warn(red(`Could not reach Ollama at ${Config.HOST}: ${result.error}.`))
    return null
  }

  if (result.models.length === 0) {
    console.warn(gray('No models installed. Pull one with `ollama pull <name>`.'))
    return null
  }

  return result.models
}

function findRequestedModels(request: string, models: string[]): string[] {
  if (/^\d+$/.test(request)) {
    const model = models[Number(request) - 1]
    return model === undefined ? [] : [model]
  }

  const exact = models.find(model => model === request)
  if (exact) {
    return [exact]
  }

  const loweredRequest = request.toLowerCase()
  return models.filter(model => model.toLowerCase().includes(loweredRequest))
}

async function applyModel(model: string): Promise<void> {
  if (isCurrentModel(model)) {
    console.warn(gray(`Already using ${model}.`))
    return
  }

  Config.MODEL = model
  await initializeContextWindow()
  console.warn(gray(`Switched to ${model}.`))
}

function printInstalledModels(models: string[]): void {
  console.warn(bold(brightGreen('\nInstalled models:')))
  models.forEach((model, index) => {
    const marker = isCurrentModel(model) ? brightGreen(' (current)') : ''
    console.warn(`  ${brightGreen(String(index + 1))}  ${model}${marker}`)
  })
  console.warn(gray('\nSwitch with /model <number|name>.'))
}

export async function changeModelInteractive(): Promise<void> {
  const models = await loadInstalledModels()
  if (!models) {
    return
  }

  const currentIndex = models.findIndex(isCurrentModel)
  const choices: SelectChoice[] = models.map(model => ({
    label: model,
    hint: isCurrentModel(model) ? '(current)' : undefined,
  }))

  const selectedIndex = await selectFromList('Select model', choices, Math.max(currentIndex, 0))
  if (selectedIndex === null) {
    return
  }

  await applyModel(models[selectedIndex]!)
}

async function run(context: CommandContext): Promise<CommandResult> {
  const request = context.args[0]

  if (!request) {
    if (stdin.isTTY) {
      await changeModelInteractive()
    }
    else {
      const models = await loadInstalledModels()
      if (models) {
        printInstalledModels(models)
      }
    }
    return { kind: 'continue' }
  }

  const models = await loadInstalledModels()
  if (!models) {
    return { kind: 'continue' }
  }

  const requestedModels = findRequestedModels(request, models)

  if (requestedModels.length === 0) {
    console.warn(red(`No model matching "${request}". Type /model to list installed models.`))
    return { kind: 'continue' }
  }

  if (requestedModels.length > 1) {
    console.warn(red(`"${request}" matches ${requestedModels.length} models: ${requestedModels.join(', ')}. Be more specific.`))
    return { kind: 'continue' }
  }

  await applyModel(requestedModels[0]!)
  return { kind: 'continue' }
}

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Switch model: /model opens a menu, or /model <number|name>.',
  run,
}
