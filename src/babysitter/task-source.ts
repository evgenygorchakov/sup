import type { Skill } from '../skills/types.ts'
import type { ParsedStep } from './parse-sections.ts'
import type { LedgerStep } from './session.ts'
import { Config } from '../config.ts'
import { appendEvent, ensureRun } from '../journal/index.ts'
import { ledgerToolRegistered } from './ledger-tool.ts'
import { buildLedgerFromSteps } from './ledger.ts'
import { extractSteps, findSection, STEPS_HEADINGS, VERIFICATION_HEADINGS } from './parse-sections.ts'
import { activateTask, getLedger, getVerificationSource } from './session.ts'

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

function ledgerNote(steps: ParsedStep[]): string {
  if (steps.every(step => step.done)) {
    return `[harness] This skill is gated: all ${steps.length} of its step(s) are already marked done, so there is nothing left to work through. Do not redo them.`
  }
  return `[harness] This skill is gated: its ${steps.length} step(s) are now tracked as a ledger. Work through them in order and mark each with ledger_update.`
}

export function activateSkill(skill: Skill): string | null {
  if (!gatedSkillsEnabled()) {
    return null
  }
  const steps = extractSteps(findSection(skill.body, STEPS_HEADINGS) ?? '')
  if (steps.length === 0) {
    return null
  }
  const ledger = ledgerToolRegistered ? buildLedgerFromSteps(steps) : null
  const verificationSource = findSection(skill.body, VERIFICATION_HEADINGS)
  if (!ledger && !verificationSource) {
    return null
  }
  installTask(`skill:${skill.name}`, ledger, verificationSource)

  const notes = [
    ledger ? ledgerNote(steps) : '',
    verificationSource ? '[harness] Before you finish, the harness will run this skill\'s Verification checks; you cannot finish until they pass.' : '',
  ].filter(Boolean)
  return ['', ...notes].join('\n')
}
