#!/usr/bin/env node
/** Run the node-level checks — everything that needs neither Ollama nor a terminal.
 *
 *     node test/run.ts              # unit/ then stub/, in path order
 *     node test/run.ts plan         # only files whose slug contains one of these
 *     node test/run.ts --list       # what is there
 *
 * A check file is named by its path under test/: test/unit/plan.ts is `unit/plan`. Each one runs
 * as its own process — they chdir and set env before importing src, so they cannot share one.
 * Live scenarios are a separate runner: python3 test/run.py.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const TEST_ROOT = dirname(fileURLToPath(import.meta.url))
const LEVELS = ['unit', 'stub']

const GREEN = '\x1b[32m', RED = '\x1b[31m', GRAY = '\x1b[90m', RESET = '\x1b[0m'
const RULE = '─'.repeat(78)

const files = LEVELS.flatMap(level => readdirSync(join(TEST_ROOT, level))
  .filter(entry => entry.endsWith('.ts'))
  .sort()
  .map(entry => join(TEST_ROOT, level, entry)))

const slug = (file: string): string => relative(TEST_ROOT, file).replace(/\.ts$/, '')

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const flags = new Set(process.argv.slice(2).filter(arg => arg.startsWith('--')))

if (flags.has('--list')) {
  for (const file of files) console.log(`  ${slug(file)}`)
  process.exit(0)
}

const chosen = files.filter(file => args.length === 0 || args.some(arg => slug(file).includes(arg)))
if (chosen.length === 0) {
  console.error(`No check file matches ${args.join(', ')}. Try --list.`)
  process.exit(1)
}

const results = chosen.map((file) => {
  console.log(`\n${GRAY}${RULE}${RESET}\n▶  ${slug(file)}\n`)
  const { status } = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  return { slug: slug(file), ok: status === 0 }
})

console.log(`\n${GRAY}${RULE}${RESET}\n=== SUMMARY ===`)
for (const result of results) {
  console.log(`  ${result.ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`}  ${result.slug}`)
}
const broken = results.filter(result => !result.ok).length
console.log(`\n${results.length - broken}/${results.length} ok`)
process.exit(broken === 0 ? 0 : 1)
