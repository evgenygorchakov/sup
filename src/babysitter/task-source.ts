import type { Skill } from '../skills/types.ts'
import type { LedgerStep } from './session.ts'
import { Config } from '../config.ts'
import { appendEvent, ensureRun } from './journal.ts'
import { buildLedgerFromSteps } from './ledger.ts'
import { extractSteps, findSection } from './parse-sections.ts'
import { activateTask, getLedger, getVerificationSource } from './session.ts'

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

export function activatePlan(planContent: string): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  installTask('plan', ledgerFor(planContent), findSection(planContent, 'verification'))
}

function gatedSkillsEnabled(): boolean {
  return Config.USE_BABYSITTER && Config.BABYSITTER_GATED_SKILLS
}

export function isGatedSkill(skill: Skill): boolean {
  if (!gatedSkillsEnabled()) {
    return false
  }
  return findSection(skill.body, 'steps') !== null
}

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
