/** /search-provider: switching web_search between providers inside a session, and how each
 *  provider reports that it is not configured. No network, no terminal — the interactive menu
 *  needs a TTY and is not exercised here. Run with: node test/run.ts (or node test/unit/search-provider.ts). */
import process from 'node:process'
import { check, done } from '../lib/check.ts'
import { Config } from '../../src/config.ts'
import { commands } from '../../src/commands/registry.ts'
import { searchProviderCommand } from '../../src/commands/list/search-provider.ts'
import { getSearchProvider } from '../../src/web/search/registry.ts'

async function warningsOf(...args: string[]): Promise<string[]> {
  const original = console.warn
  const lines: string[] = []
  console.warn = (line: unknown) => void lines.push(String(line))

  try {
    await searchProviderCommand.run({ messages: [], args, commands: [] })
  }
  finally {
    console.warn = original
  }

  return lines.map(line => line.replace(/\x1B\[\d+m/g, ''))
}

// --- a provider knows when its own setting is missing
const savedKey = process.env.OLLAMA_API_KEY
delete process.env.OLLAMA_API_KEY
check('ollama: without a key it says which one', getSearchProvider('ollama').unavailableReason?.()?.startsWith('OLLAMA_API_KEY is not set'), true)
process.env.OLLAMA_API_KEY = 'test-key'
check('ollama: with a key nothing is missing', getSearchProvider('ollama').unavailableReason?.(), undefined)

Config.WEB_SEARCH_HOST = ''
check('searxng: an empty host is what is missing', getSearchProvider('searxng').unavailableReason?.()?.startsWith('WEB_SEARCH_HOST is empty'), true)
Config.WEB_SEARCH_HOST = 'not a url'
check('searxng: a broken host is named too', getSearchProvider('searxng').unavailableReason?.()?.startsWith('WEB_SEARCH_HOST is not a valid URL'), true)
Config.WEB_SEARCH_HOST = 'http://localhost:8888'
check('searxng: a usable host leaves nothing missing', getSearchProvider('searxng').unavailableReason?.(), undefined)

// --- the command moves web_search from one provider to the other
Config.WEB_SEARCH_PROVIDER = 'ollama'
check('switch: the reply says where web_search goes now', await warningsOf('searxng'), ['web_search now goes through searxng.'])
check('switch: the config follows', Config.WEB_SEARCH_PROVIDER, 'searxng')

check('switch: the name is case-insensitive', await warningsOf('OLLAMA'), ['web_search now goes through ollama.'])
check('switch: the config follows the lowercased name', Config.WEB_SEARCH_PROVIDER, 'ollama')

check('switch: switching to the current one says so', await warningsOf('ollama'), ['web_search already goes through ollama.'])

// --- an unknown name changes nothing and lists what there is
check('unknown: the reply lists the providers', await warningsOf('duckduckgo'), ['No search provider named "duckduckgo". Available: ollama, searxng.'])
check('unknown: the config is left alone', Config.WEB_SEARCH_PROVIDER, 'ollama')

// --- switching to a provider that is not configured still happens, with the reason shown
Config.WEB_SEARCH_HOST = ''
const unconfigured = await warningsOf('searxng')
check('unconfigured: the switch is reported first', unconfigured[0], 'web_search now goes through searxng.')
check('unconfigured: the missing setting comes next', unconfigured[1]?.startsWith('WEB_SEARCH_HOST is empty'), true)
check('unconfigured: nothing else is printed', unconfigured.length, 2)
check('unconfigured: the switch still took', Config.WEB_SEARCH_PROVIDER, 'searxng')

// --- the command is reachable as a slash command
check('registry: the command is registered', commands.some(command => command.name === 'search-provider'), true)

if (savedKey === undefined) {
  delete process.env.OLLAMA_API_KEY
}
else {
  process.env.OLLAMA_API_KEY = savedKey
}

done()
