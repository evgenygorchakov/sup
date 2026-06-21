// The TODO ledger: a structured, stateful step list re-injected every turn so
// small models keep their place instead of drifting. Steps are seeded from a
// plan's "Steps" section or a gated skill, and advanced via the ledger_update
// tool.

import type { Message } from '../types.ts'
import type { LedgerStep, StepStatus } from './session.ts'
import { getLedger } from './session.ts'

export function buildLedgerFromSteps(steps: string[]): LedgerStep[] {
  return steps.map((text, index) => ({ id: index + 1, text, status: 'pending' as const }))
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
        ? `Work on step ${currentStep.id} next. Do not skip ahead and do not redo completed steps. Call ledger_update to mark a step in_progress when you start it and done when it is finished.`
        : 'Every step is marked done. Run the verification checks, then finish with a plain-text reply and no tool calls.',
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
  step.status = status
  return `Step ${id} marked ${status}.`
}
