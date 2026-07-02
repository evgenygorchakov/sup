import type { Skill } from '../skills/types.ts'
import type { LedgerStep } from './session.ts'
import { Config } from '../config.ts'
import { appendEvent, ensureRun } from './journal.ts'
import { ledgerToolRegistered } from './ledger-tool.ts'
import { buildLedgerFromSteps } from './ledger.ts'
import { extractSteps, findSection } from './parse-sections.ts'
import { activateTask, getLedger, getVerificationSource } from './session.ts'

export const STEPS_HEADINGS = ['steps', 'шаги'] as const
export const VERIFICATION_HEADINGS = ['verification', 'проверка', 'верификация'] as const

function installTask(source: string, ledger: LedgerStep[] | null, verificationSource: string | null): void {
  ensureRun()
  activateTask(ledger, verificationSource)
  appendEvent('ledger', { source, ledger: getLedger(), verificationSource: getVerificationSource() })
}

function ledgerFor(markdown: string): LedgerStep[] | null {
  if (!ledgerToolRegistered) {
    return null
  }
  const steps = extractSteps(findSection(markdown, STEPS_HEADINGS) ?? '')
  return steps.length > 0 ? buildLedgerFromSteps(steps) : null
}

export function activatePlan(planContent: string): void {
  if (!Config.USE_BABYSITTER) {
    return
  }
  installTask('plan', ledgerFor(planContent), findSection(planContent, VERIFICATION_HEADINGS))
}

function gatedSkillsEnabled(): boolean {
  return Config.USE_BABYSITTER && Config.BABYSITTER_GATED_SKILLS
}

export function isGatedSkill(skill: Skill): boolean {
  if (!gatedSkillsEnabled()) {
    return false
  }
  return findSection(skill.body, STEPS_HEADINGS) !== null
}

export function activateSkill(skill: Skill): string | null {
  if (!isGatedSkill(skill)) {
    return null
  }
  const steps = extractSteps(findSection(skill.body, STEPS_HEADINGS) ?? '')
  if (steps.length === 0) {
    return null
  }
  const verificationSource = findSection(skill.body, VERIFICATION_HEADINGS)
  installTask(`skill:${skill.name}`, ledgerToolRegistered ? buildLedgerFromSteps(steps) : null, verificationSource)

  return [
    '',
    ledgerToolRegistered ? `[harness] This skill is gated: its ${steps.length} step(s) are now tracked as a ledger. Work through them in order and mark each with ledger_update.` : '',
    verificationSource ? '[harness] Before you finish, the harness will run this skill\'s Verification checks; you cannot finish until they pass.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}
