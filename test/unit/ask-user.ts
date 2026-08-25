import process from 'node:process'
import { check, done } from '../lib/check.ts'

Object.assign(process.env, { USE_ASK_USER: 'true' })

const { checkAskGate, noteAskGateCall, noteQuestionAsked, resetAskGate } = await import('../../src/tools/ask-gate.ts')
const { parseAskUserArguments } = await import('../../src/tools/list/ask-user.ts')

type ToolCall = import('../../src/types.ts').ToolCall

const call = (name: string): ToolCall => ({ id: name, function: { name, arguments: {} } })
const QUESTION = 'Named export or default?'
const refused = (): boolean => checkAskGate() !== null

resetAskGate()
check('refused with nothing investigated', refused(), true)
check('and the refusal says what to do instead', checkAskGate()?.includes('read the relevant files'), true)
noteAskGateCall(call('read_file'))
check('still refused one call short', refused(), true)
noteAskGateCall(call('grep'))
check('allowed once the minimum is met', refused(), false)

resetAskGate()
noteAskGateCall(call('write_file'))
noteAskGateCall(call('edit_file'))
noteAskGateCall(call('ask_user'))
check('edits do not buy a question', refused(), true)

for (const name of ['read_file', 'grep', 'glob', 'run_shell', 'fetch_url', 'web_search', 'skill']) {
  resetAskGate()
  noteAskGateCall(call(name))
  noteAskGateCall(call(name))
  check(`${name} counts as investigating`, refused(), false)
}

resetAskGate()
noteAskGateCall(call('read_file'))
noteAskGateCall(call('read_file'))
noteQuestionAsked()
check('the budget is spent after one question', refused(), true)
check('and the refusal says to decide and state the assumption', checkAskGate()?.includes('what you assumed'), true)

noteAskGateCall(call('grep'))
noteAskGateCall(call('grep'))
check('more reading does not buy another question', refused(), true)

resetAskGate()
check('a new turn starts with an empty budget', checkAskGate()?.includes('investigated 0 time'), true)

const parse = (question: unknown, options: unknown): ReturnType<typeof parseAskUserArguments> =>
  parseAskUserArguments({ question, options })

check('two options are enough', parse(QUESTION, ['Named', 'Default']).ok, true)
check('four options are still fine', parse(QUESTION, ['a', 'b', 'c', 'd']).ok, true)
const oneOption = parse(QUESTION, ['Named'])
check('one option is not a question', oneOption.ok, false)
check('and it is told to decide instead', oneOption.ok === false && oneOption.error.includes('state the assumption'), true)
check('five options are too many', parse(QUESTION, ['a', 'b', 'c', 'd', 'e']).ok, false)
check('options must be an array', parse(QUESTION, 'Named or default').ok, false)
check('empty entries are refused', parse(QUESTION, ['Named', '   ']).ok, false)
check('duplicates are refused', parse(QUESTION, ['Named', 'named']).ok, false)
check('an essay is not an option', parse(QUESTION, ['Named', 'x'.repeat(101)]).ok, false)
check('a blank question is refused', parse('   ', ['Named', 'Default']).ok, false)
check('surrounding whitespace is trimmed', parse(` ${QUESTION} `, [' Named ', 'Default']), { ok: true, question: QUESTION, options: ['Named', 'Default'] })

done()
