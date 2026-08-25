/** Plan mode, pure logic: mode cycling and memory, the active-plan reminder, section parsing, the plan store.
 *  No provider, no terminal, no Ollama. Run with: node test/run.ts (or node test/unit/plan.ts). */
import { check, done } from '../lib/check.ts'
import { clearActivePlan, buildPlanReminder, setActivePlan } from '../../src/plan/active-plan.ts'
import { clearAutoElevation, cycleMode, elevateAutoForTurn, getMode, isAutoModeActive, leavePlanMode, setMode } from '../../src/plan/mode-state.ts'
import { listPlans, planBody, savePlan } from '../../src/plan/store.ts'
import { extractCommands, extractSteps, findSection, STEPS_HEADINGS, VERIFICATION_HEADINGS } from '../../src/babysitter/parse-sections.ts'


// --- mode cycling
setMode('plan')
check('cycle plan -> normal', cycleMode(), 'normal')
check('cycle normal -> auto', cycleMode(), 'auto')
check('cycle auto -> plan', cycleMode(), 'plan')

// --- plan mode is a detour, so leaving it lands back where the session was
setMode('auto')
setMode('plan')
check('an auto session comes back to auto', leavePlanMode(), 'auto')
setMode('normal')
setMode('plan')
check('a normal session comes back to normal', leavePlanMode(), 'normal')
setMode('auto')
cycleMode()
check('Shift+Tab into plan remembers auto too', leavePlanMode(), 'auto')
setMode('auto')
setMode('plan')
setMode('plan')
check('entering plan twice does not forget it', leavePlanMode(), 'auto')
setMode('auto')
setMode('plan')
setMode('normal')
setMode('plan')
check('switching modes by hand is the new baseline', leavePlanMode(), 'normal')

// --- `a` at the plan prompt: auto-approve for the task, not for the session
setMode('normal')
elevateAutoForTurn()
check('a auto-approves edits while the task runs', isAutoModeActive(), true)
check('and leaves the session mode alone', getMode(), 'normal')
clearAutoElevation()
check('and is gone once the turn ends', isAutoModeActive(), false)

// --- active plan reminder
clearActivePlan()
check('no reminder without a plan', buildPlanReminder(), null)
setActivePlan('## Steps\n1. do it\n')
check('reminder without Verification', buildPlanReminder()?.content.includes('After the last step'), false)
setActivePlan('## Steps\n1. do it\n\n## Verification\n- `node --check calc.js`\n')
check('reminder with Verification', buildPlanReminder()?.content.includes('After the last step'), true)
setActivePlan('   ')
check('blank plan clears the reminder', buildPlanReminder(), null)

// --- section parsing at both heading levels, and Russian headings
const h2 = '## Context\nx\n\n## Steps\n1. one\n2. two\n\n## Verification\n1. `node --check calc.js`\n'
const h1 = h2.replaceAll('## ', '# ')
const ru = '## Контекст\nx\n\n## Шаги\n1. один\n\n## Проверка\n- `node --check calc.js`\n'
check('steps at level 2', extractSteps(findSection(h2, STEPS_HEADINGS) ?? '').length, 2)
check('steps at level 1', extractSteps(findSection(h1, STEPS_HEADINGS) ?? '').length, 2)
check('russian headings', extractSteps(findSection(ru, STEPS_HEADINGS) ?? '').length, 1)
check('verification commands', extractCommands(findSection(h2, VERIFICATION_HEADINGS) ?? ''), ['node --check calc.js'])
const piped = '## Verification\n- `node -e "import(\'./calc.js\')" | head`\n'
check('piped command is dropped', extractCommands(findSection(piped, VERIFICATION_HEADINGS) ?? ''), [])

// --- store round-trip
const { mkdtemp } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
process.chdir(await mkdtemp(join(tmpdir(), 'sup-plans-')))
const body = '## Context\nrt\n\n## Steps\n1. one\n'
const saved = await savePlan(body, 'multi\nline   request')
check('savePlan returns a path', typeof saved === 'string' && saved.startsWith('.sup/plans/'), true)
const plans = await listPlans()
check('listPlans finds it', plans.length, 1)
check('request line is flattened', plans[0]?.request, 'multi line request')
const { readFile } = await import('node:fs/promises')
const content = await readFile(plans[0]!.file, 'utf8')
check('planBody strips the metadata header', planBody(content).trim(), body.trim())
check('empty plan is not saved', await savePlan('   ', 'x'), null)

done()
