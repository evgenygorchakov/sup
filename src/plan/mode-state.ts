import { Config } from '../config.ts'
import { yellow } from '../utils/colors.ts'

export type AgentMode = 'normal' | 'auto' | 'plan'

const CYCLE: readonly AgentMode[] = ['normal', 'auto', 'plan']

function initialMode(): AgentMode {
  if (Config.USE_READ_ONLY_MODE) {
    if (Config.USE_PLAN_MODE || Config.USE_AUTO_MODE) {
      console.warn(yellow('Read-only mode: USE_PLAN_MODE and USE_AUTO_MODE are ignored.'))
    }
    return 'normal'
  }
  if (Config.USE_PLAN_MODE) {
    if (Config.USE_AUTO_MODE) {
      console.warn(yellow('Both USE_PLAN_MODE and USE_AUTO_MODE are set; starting in plan mode.'))
    }
    return 'plan'
  }
  if (Config.USE_AUTO_MODE) {
    return 'auto'
  }
  return 'normal'
}

let mode: AgentMode = initialMode()

export function getMode(): AgentMode {
  return mode
}

export function setMode(value: AgentMode): void {
  mode = value
}

export function cycleMode(): AgentMode {
  const index = CYCLE.indexOf(mode)
  mode = CYCLE[(index + 1) % CYCLE.length]!
  return mode
}

export function isPlanModeActive(): boolean {
  return mode === 'plan'
}

export function isAutoModeActive(): boolean {
  return mode === 'auto'
}
