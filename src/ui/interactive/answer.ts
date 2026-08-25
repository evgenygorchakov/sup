/** How the approval prompts read a typed answer. English only, and deliberately short: the terse
 *  `y` / `a` / `n` plus their spelled-out forms. Everything else is feedback — what the user wants
 *  changed — so a near-miss is announced instead of quietly starting another round. */

export type AnswerIntent = 'yes' | 'auto' | 'no' | 'feedback'

const YES = new Set(['y', 'yes'])
const AUTO = new Set(['a', 'auto'])
const NO = new Set(['n', 'no'])

export function readAnswerIntent(answer: string): AnswerIntent {
  const word = answer.trim().toLowerCase()

  if (YES.has(word)) {
    return 'yes'
  }
  if (AUTO.has(word)) {
    return 'auto'
  }
  if (NO.has(word)) {
    return 'no'
  }

  return 'feedback'
}

/** A short unrecognized answer — a wrong keyboard layout, a stray letter — is much more likely a
 *  mistyped `y` or `n` than a remark on the plan, and feedback is expensive: it spends a whole
 *  planning round. Those get told how the answer was read. */
export function looksMistyped(answer: string): boolean {
  const word = answer.trim()
  return word.length > 0 && word.length <= 3 && !/\s/.test(word)
}

export const FEEDBACK_NOTICE = 'Read as feedback. Approve with y, reject with n.'
