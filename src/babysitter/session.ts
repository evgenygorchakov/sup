// In-memory state for a babysitter-controlled task: the active step ledger, the
// verification source, and the completion-gate counters. Module-level singleton,
// mirroring the setter style of src/plan/active-plan.ts and src/plan/mode-state.ts.

export type StepStatus = 'pending' | 'in_progress' | 'done'

export interface LedgerStep {
  id: number
  text: string
  status: StepStatus
}

interface TaskState {
  ledger: LedgerStep[] | null
  verificationSource: string | null
  gateAttempts: number
  gatePassed: boolean
  shellRanSinceGate: boolean
}

const task: TaskState = {
  ledger: null,
  verificationSource: null,
  gateAttempts: 0,
  gatePassed: false,
  shellRanSinceGate: false,
}

function resetGateState(): void {
  task.gateAttempts = 0
  task.gatePassed = false
  task.shellRanSinceGate = false
}

// --- reads ---

export function getLedger(): LedgerStep[] | null {
  return task.ledger
}

export function getVerificationSource(): string | null {
  return task.verificationSource
}

export function getGateAttempts(): number {
  return task.gateAttempts
}

export function isGatePassed(): boolean {
  return task.gatePassed
}

export function hasShellRunSinceGate(): boolean {
  return task.shellRanSinceGate
}

// --- writes ---

// Activate a new task: install its ledger + verification source and reset the
// gate so verification runs fresh for this task.
export function activateTask(ledger: LedgerStep[] | null, verificationSource: string | null): void {
  task.ledger = ledger && ledger.length > 0 ? ledger : null
  task.verificationSource = verificationSource?.trim() || null
  resetGateState()
}

export function clearTask(): void {
  task.ledger = null
  task.verificationSource = null
  resetGateState()
}

// A new user turn invalidates a previously passed gate: new instructions must be
// verified again before the next finish.
export function resetGate(): void {
  resetGateState()
}

export function noteShellRun(): void {
  task.shellRanSinceGate = true
}

export function markGatePassed(): void {
  task.gatePassed = true
}

export function recordGateAttempt(): void {
  task.gateAttempts += 1
}

// After asking the model to verify manually, demand a fresh shell run before we
// will accept the next finish.
export function requireFreshShellRun(): void {
  task.shellRanSinceGate = false
}

export function markAllStepsDone(): void {
  if (!task.ledger) {
    return
  }
  for (const step of task.ledger) {
    step.status = 'done'
  }
}
