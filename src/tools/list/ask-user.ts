import type { Tool } from '../../types.ts'
import type { SelectChoice } from '../../ui/interactive/select.ts'

import process from 'node:process'
import { selectFromList } from '../../ui/interactive/select.ts'
import { brightBlue } from '../../utils/colors.ts'
import { checkAskGate, noteQuestionAsked } from '../ask-gate.ts'

export const ASK_USER_TOOL_NAME = 'ask_user'

const MIN_OPTIONS = 2
const MAX_OPTIONS = 4
const MAX_OPTION_LENGTH = 100

const OTHER_LABEL = 'None of these — let me explain'

const DISMISSED = 'The user dismissed the question without answering. Do not ask again: pick the option you think is right, say which one you picked and why, and continue.'
const REJECTED_ALL = 'The user rejected every option you offered and wants to explain in their own words. Stop here: reply in plain text with no tool calls, stating briefly what you need to know.'

type ParsedArguments
  = | { ok: true, question: string, options: string[] }
    | { ok: false, error: string }

export function parseAskUserArguments(rawArguments: unknown): ParsedArguments {
  const args = (rawArguments ?? {}) as { question?: unknown, options?: unknown }

  const question = typeof args.question === 'string' ? args.question.trim() : ''
  if (!question) {
    return { ok: false, error: 'ask_user needs a non-empty "question".' }
  }

  if (!Array.isArray(args.options)) {
    return { ok: false, error: `ask_user needs "options": an array of ${MIN_OPTIONS}-${MAX_OPTIONS} concrete answers.` }
  }

  const options = args.options.map(option => (typeof option === 'string' ? option.trim() : ''))

  if (options.some(option => option === '')) {
    return { ok: false, error: 'every entry in "options" must be a non-empty string.' }
  }

  if (options.length < MIN_OPTIONS) {
    return {
      ok: false,
      error: `"options" has ${options.length}, and a question needs at least ${MIN_OPTIONS} alternatives. If you cannot name two concrete alternatives you do not have a question: choose what seems right, state the assumption, and continue.`,
    }
  }

  if (options.length > MAX_OPTIONS) {
    return { ok: false, error: `"options" has ${options.length} entries, and at most ${MAX_OPTIONS} are allowed. Offer only the alternatives that really differ.` }
  }

  const seen = new Set(options.map(option => option.toLowerCase()))
  if (seen.size !== options.length) {
    return { ok: false, error: 'the entries in "options" must differ from each other.' }
  }

  const tooLong = options.find(option => option.length > MAX_OPTION_LENGTH)
  if (tooLong !== undefined) {
    return { ok: false, error: `each option must be at most ${MAX_OPTION_LENGTH} characters; "${tooLong.slice(0, 40)}…" is ${tooLong.length}. Put the detail in the question, keep the options short.` }
  }

  return { ok: true, question, options }
}

export const askUser: Tool = {
  definition: {
    type: 'function',
    function: {
      name: ASK_USER_TOOL_NAME,
      description: 'Asks the user one multiple-choice question and returns the answer they picked. USE WHEN: the task has two genuinely different readings, the choice changes what you would build, and nothing in the project settles it. DO NOT USE FOR: anything read_file, grep or glob could tell you — look first; confirming a decision you are already confident about; open questions ("what would you like?"); reporting progress or announcing what you are about to do. You get one question per turn and only after you have investigated, so spend it on the choice that matters most. If you cannot name at least two concrete alternatives, you do not have a question: make the sensible choice, say what you assumed, and carry on. EXAMPLE: {"question": "calc.js has both a default export and named ones — which should div use?", "options": ["A named export, like add and sub", "The default export"]}.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'One specific question, naming the file, symbol or behaviour it is about. The user sees it as written.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: `${MIN_OPTIONS} to ${MAX_OPTIONS} short, concrete alternatives, each a complete answer to the question on its own. Not "yes"/"no" unless those really are the alternatives.`,
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  handler: async (rawArguments: unknown) => {
    const parsed = parseAskUserArguments(rawArguments)
    if (!parsed.ok) {
      return `ERROR: ${parsed.error}`
    }

    const refusal = checkAskGate()
    if (refusal) {
      return `ERROR: refused by the harness — ${refusal}`
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return 'ERROR: there is no terminal to ask on. Pick the option you think is right, say which one you picked and why, and continue.'
    }

    const choices: SelectChoice[] = [
      ...parsed.options.map(label => ({ label })),
      { label: OTHER_LABEL, hint: '(answer in your own words)' },
    ]

    const chosen = await selectFromList(parsed.question, choices)

    noteQuestionAsked()

    if (chosen === null) {
      return DISMISSED
    }

    if (chosen === parsed.options.length) {
      return REJECTED_ALL
    }

    return `The user answered: ${parsed.options[chosen]}`
  },
  primaryArgs: ['question'],
  accentColor: brightBlue,
  autoApprove: true,
}
