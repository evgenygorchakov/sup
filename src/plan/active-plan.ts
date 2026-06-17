import type { Message } from '../types.ts'

let plan: string | null = null

export function setActivePlan(content: string): void {
  plan = content.trim() || null
}

export function clearActivePlan(): void {
  plan = null
}

export function buildPlanReminder(): Message | null {
  if (!plan) {
    return null
  }

  return {
    role: 'user',
    content: [
      'Reminder from the harness, not from the user. The approved plan is repeated below.',
      'Compare it with the work already done above, then continue with the first step that is not completed yet. Do not redo completed steps.',
      'Only the steps in the plan are in scope. After the last step, run the checks from the "Verification" section.',
      '',
      plan,
    ].join('\n'),
  }
}
