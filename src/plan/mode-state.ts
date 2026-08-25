import { Config } from '../config.ts'
import { yellow } from '../utils/colors.ts'
import { isEnvSet } from '../utils/env.ts'

export type AgentMode = 'normal' | 'auto' | 'plan'

const CYCLE: readonly AgentMode[] = ['normal', 'auto', 'plan']

let mode: AgentMode | null = null
/** Where to land when plan mode ends: planning is a detour, it must not rewrite the mode the session runs in. */
let modeBeforePlan: AgentMode | null = null
/** `a` at the plan prompt auto-approves edits for the turn that executes the plan, and no longer. */
let autoForThisTurn = false

function configuredMode(): AgentMode {
  return Config.USE_AUTO_MODE ? 'auto' : 'normal'
}

function initialMode(): AgentMode {
  const autoRequested = Config.USE_AUTO_MODE && isEnvSet('USE_AUTO_MODE')

  if (Config.USE_PLAN_MODE) {
    if (autoRequested) {
      console.warn(yellow('Both USE_PLAN_MODE and USE_AUTO_MODE are set; starting in plan mode, auto mode takes over once plan mode ends.'))
    }
    modeBeforePlan = configuredMode()
    return 'plan'
  }
  return configuredMode()
}

export function getMode(): AgentMode {
  mode ??= initialMode()
  return mode
}

export function setMode(value: AgentMode): void {
  const previous = getMode()

  if (value !== 'plan') {
    // Switching modes by hand is a new baseline, so there is nothing left to come back to.
    modeBeforePlan = null
  }
  else if (previous !== 'plan') {
    modeBeforePlan = previous
  }

  mode = value
}

/** Ends plan mode in the mode it was entered from — approving a plan must not silently drop an auto session into normal. */
export function leavePlanMode(): AgentMode {
  const restored = modeBeforePlan ?? configuredMode()
  modeBeforePlan = null
  mode = restored
  return restored
}

export function cycleMode(): AgentMode {
  const index = CYCLE.indexOf(getMode())
  setMode(CYCLE[(index + 1) % CYCLE.length]!)
  return getMode()
}

export function elevateAutoForTurn(): void {
  autoForThisTurn = true
}

export function clearAutoElevation(): void {
  autoForThisTurn = false
}

export function isPlanModeActive(): boolean {
  return getMode() === 'plan'
}

export function isAutoModeActive(): boolean {
  return autoForThisTurn || getMode() === 'auto'
}
