import { Config } from './config.ts'

let active = Config.USE_PLAN_MODE

export function isPlanModeActive(): boolean {
  return active
}

export function setPlanModeActive(value: boolean): void {
  active = value
}
