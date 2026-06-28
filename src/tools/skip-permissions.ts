let skipPermissions = false

export function setSkipPermissions(value: boolean): void {
  skipPermissions = value
}

export function isSkipPermissionsActive(): boolean {
  return skipPermissions
}
