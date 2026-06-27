import { Config } from '../config.ts'

export type AgentMode = 'normal' | 'auto' | 'plan'

const CYCLE: readonly AgentMode[] = ['normal', 'auto', 'plan']

function initialMode(): AgentMode {
  if (Config.USE_READ_ONLY_MODE) {
    return 'normal'
  }
  if (Config.USE_PLAN_MODE) {
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
