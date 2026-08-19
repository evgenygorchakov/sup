import { Config } from '../config.ts'
import { yellow } from '../utils/colors.ts'
import { isEnvSet } from '../utils/env.ts'

export type AgentMode = 'normal' | 'auto' | 'plan'

const CYCLE: readonly AgentMode[] = ['normal', 'auto', 'plan']

function initialMode(): AgentMode {
  const autoRequested = Config.USE_AUTO_MODE && isEnvSet('USE_AUTO_MODE')

  if (Config.USE_PLAN_MODE) {
    if (autoRequested) {
      console.warn(yellow('Both USE_PLAN_MODE and USE_AUTO_MODE are set; starting in plan mode.'))
    }
    return 'plan'
  }
  if (Config.USE_AUTO_MODE) {
    return 'auto'
  }
  return 'normal'
}

let mode: AgentMode | null = null

export function getMode(): AgentMode {
  mode ??= initialMode()
  return mode
}

export function setMode(value: AgentMode): void {
  mode = value
}

export function cycleMode(): AgentMode {
  const index = CYCLE.indexOf(getMode())
  mode = CYCLE[(index + 1) % CYCLE.length]!
  return mode
}

export function isPlanModeActive(): boolean {
  return getMode() === 'plan'
}

export function isAutoModeActive(): boolean {
  return getMode() === 'auto'
}
