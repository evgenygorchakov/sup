// Seeds a task (ledger + verification source) from an approved plan or a gated
// skill. Kept separate from the agent so the wiring there stays a one-line hook.

import type { Skill } from '../skills/types.ts'
import type { LedgerStep } from './session.ts'
import { Config } from '../config.ts'
import { appendEvent, ensureRun } from './journal.ts'
import { buildLedgerFromSteps } from './ledger.ts'
import { extractSteps, findSection } from './parse-sections.ts'
import { activateTask, getLedger, getVerificationSource } from './session.ts'

// Open a run, activate the task, and record it in the journal so a resume can
// pick the ledger back up.
function installTask(source: string, ledger: LedgerStep[] | null, verificationSource: string | null): void {
  ensureRun()
  activateTask(ledger, verificationSource)
  appendEvent('ledger', { source, ledger: getLedger(), verificationSource: getVerificationSource() })
}

function ledgerFor(markdown: string): LedgerStep[] | null {
  if (!Config.BABYSITTER_LEDGER) {
    return null
  }
  const steps = extractSteps(findSection(markdown, 'steps') ?? '')
  return steps.length > 0 ? buildLedgerFromSteps(steps) : null
}

// Called when a plan is approved: seed the ledger from its Steps section and the
// gate from its Verification section.
export function activatePlan(planContent: string): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  installTask('plan', ledgerFor(planContent), findSection(planContent, 'verification'))
}

function gatedSkillsEnabled(): boolean {
  return Config.USE_BABYSITTER && Config.BABYSITTER_GATED_SKILLS
}

// A skill is "gated" when it declares an ordered Steps section.
export function isGatedSkill(skill: Skill): boolean {
  if (!gatedSkillsEnabled()) {
    return false
  }
  return findSection(skill.body, 'steps') !== null
}

// Called when a skill is loaded: if it is gated, seed the ledger + gate from it
// and return a short note to append to the skill instructions (or null).
export function activateSkill(skill: Skill): string | null {
  if (!isGatedSkill(skill)) {
    return null
  }
  const steps = extractSteps(findSection(skill.body, 'steps') ?? '')
  if (steps.length === 0) {
    return null
  }
  const verificationSource = findSection(skill.body, 'verification')
  installTask(`skill:${skill.name}`, buildLedgerFromSteps(steps), verificationSource)

  return [
    '',
    `[harness] This skill is gated: its ${steps.length} step(s) are now tracked as a ledger. Work through them in order and mark each with ledger_update.`,
    verificationSource ? '[harness] Before you finish, the harness will run this skill\'s Verification checks; you cannot finish until they pass.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}
