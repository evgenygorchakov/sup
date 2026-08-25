/** What the approval prompts make of a typed answer: the terse letters, their English words, and
 *  everything else as feedback. Run with: node test/run.ts (or node test/unit/answer.ts). */
import { check, done } from '../lib/check.ts'
import { looksMistyped, readAnswerIntent } from '../../src/ui/interactive/answer.ts'

// --- the letters, as before
check('y approves', readAnswerIntent('y'), 'yes')
check('a auto-approves', readAnswerIntent('a'), 'auto')
check('n rejects', readAnswerIntent('n'), 'no')

// --- the spelled-out English words, which used to start a whole planning round
check('yes approves', readAnswerIntent('yes'), 'yes')
check('auto auto-approves', readAnswerIntent('auto'), 'auto')
check('no rejects', readAnswerIntent('no'), 'no')

// --- case and stray whitespace do not change the answer
check('Y approves', readAnswerIntent('Y'), 'yes')
check('YES approves', readAnswerIntent('YES'), 'yes')
check('  n  rejects', readAnswerIntent('  n  '), 'no')

// --- anything else is a remark on the plan
check('a sentence is feedback', readAnswerIntent('use edit_file instead'), 'feedback')
check('yes with a remark is feedback', readAnswerIntent('yes but skip step 3'), 'feedback')
check('cyrillic is feedback', readAnswerIntent('н'), 'feedback')
check('empty is feedback', readAnswerIntent(''), 'feedback')

// --- and a short near-miss says so instead of quietly spending a round
check('a stray letter looks mistyped', looksMistyped('н'), true)
check('a wrong-layout word looks mistyped', looksMistyped('нет'), true)
check('real feedback does not', looksMistyped('use edit_file instead'), false)
check('one long word does not', looksMistyped('rethink'), false)
check('empty does not', looksMistyped('   '), false)

done()
