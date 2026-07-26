import type { Message } from '../types.ts'
import type { ParsedStep } from './parse-sections.ts'
import type { LedgerStep, StepStatus } from './session.ts'
import { getLedger, getVerificationSource } from './session.ts'

export function buildLedgerFromSteps(steps: ParsedStep[]): LedgerStep[] {
  return steps.map((step, index) => ({ id: index + 1, text: step.text, status: step.done ? 'done' : 'pending' }))
}

function checkbox(status: StepStatus): string {
  if (status === 'done') {
    return '[x]'
  }
  if (status === 'in_progress') {
    return '[~]'
  }
  return '[ ]'
}

export function buildLedgerReminder(): Message | null {
  const ledger = getLedger()
  if (!ledger || ledger.length === 0) {
    return null
  }

  const currentStep = ledger.find(step => step.status !== 'done')
  const lines = ledger.map(step => `${checkbox(step.status)} ${step.id}. ${step.text}`)

  return {
    role: 'user',
    content: [
      'Reminder from the harness, not from the user. This is your task ledger.',
      ...lines,
      '',
      currentStep
        ? currentStep.status === 'in_progress'
          ? `Step ${currentStep.id} is already marked in_progress — do not mark it again. Get it finished, then call ledger_update once to mark it done. Some steps are finished by writing the answer rather than by calling a tool.`
          : `Work on step ${currentStep.id} next. Do not skip ahead and do not redo completed steps. Call ledger_update to mark a step in_progress when you start it and done when it is finished.`
        : getVerificationSource()
          ? 'Every step is marked done. Do not redo them. Run the verification checks, then finish with a plain-text reply and no tool calls.'
          : 'Every step is marked done. Do not redo them. Finish with a plain-text reply and no tool calls.',
    ].join('\n'),
  }
}

export function markStep(id: number, status: StepStatus): string {
  const ledger = getLedger()
  if (!ledger) {
    return 'ERROR: there is no active task ledger to update.'
  }
  const step = ledger.find(entry => entry.id === id)
  if (!step) {
    return `ERROR: no ledger step with id ${id}. Valid ids: ${ledger.map(entry => entry.id).join(', ')}.`
  }
  if (step.status === status) {
    return `Step ${id} is already ${status}, so the ledger did not change. Stop updating it and get on with the work itself.`
  }
  step.status = status
  return `Step ${id} marked ${status}.`
}
