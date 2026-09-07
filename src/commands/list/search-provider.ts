import type { SelectChoice } from '../../ui/interactive/select.ts'
import type { CommandContext, CommandResult, SlashCommand } from '../types.ts'
import { stdin } from 'node:process'
import { Config } from '../../config.ts'
import { selectFromList } from '../../ui/interactive/select.ts'
import { bold, brightGreen, gray, red } from '../../utils/colors.ts'
import { getSearchProvider, searchProviderNames } from '../../web/search/registry.ts'

function isCurrentProvider(name: string): boolean {
  return name === Config.WEB_SEARCH_PROVIDER
}

function reasonFor(name: string): string | undefined {
  return getSearchProvider(name).unavailableReason?.()
}

function hintFor(name: string): string | undefined {
  if (isCurrentProvider(name)) {
    return '(current)'
  }

  return reasonFor(name) ? '(not configured)' : undefined
}

function apply(name: string): void {
  const wasCurrent = isCurrentProvider(name)
  Config.WEB_SEARCH_PROVIDER = name
  console.warn(gray(wasCurrent ? `web_search already goes through ${name}.` : `web_search now goes through ${name}.`))

  const reason = reasonFor(name)
  if (reason) {
    console.warn(red(reason))
  }
}

function printProviders(): void {
  console.warn(bold(brightGreen('\nWeb search providers:')))
  for (const name of searchProviderNames) {
    const marker = isCurrentProvider(name) ? brightGreen(' (current)') : ''
    const reason = reasonFor(name)
    console.warn(`  ${name}${marker}${reason ? gray(`\n    ${reason}`) : ''}`)
  }
  console.warn(gray('\nSwitch with /search-provider <name>.'))
}

async function chooseInteractively(): Promise<void> {
  const choices: SelectChoice[] = searchProviderNames.map(name => ({ label: name, hint: hintFor(name) }))
  const currentIndex = searchProviderNames.indexOf(Config.WEB_SEARCH_PROVIDER)

  const selectedIndex = await selectFromList('Select web search provider', choices, Math.max(currentIndex, 0))
  if (selectedIndex === null) {
    return
  }

  apply(searchProviderNames[selectedIndex]!)
}

async function run(context: CommandContext): Promise<CommandResult> {
  const request = context.args[0]?.toLowerCase()

  if (!request) {
    if (stdin.isTTY) {
      await chooseInteractively()
    }
    else {
      printProviders()
    }
    return { kind: 'continue' }
  }

  if (!searchProviderNames.includes(request)) {
    console.warn(red(`No search provider named "${request}". Available: ${searchProviderNames.join(', ')}.`))
    return { kind: 'continue' }
  }

  apply(request)
  return { kind: 'continue' }
}

export const searchProviderCommand: SlashCommand = {
  name: 'search-provider',
  description: 'Switch where web_search goes: /search-provider opens a menu, or /search-provider <name>.',
  run,
}
