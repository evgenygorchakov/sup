/** The assert shared by the node-level checks in test/unit and test/stub.
 *  Compares by JSON shape, prints one line per check, and remembers what failed —
 *  every check file ends with `done()`, whose exit code is what test/run.ts reports. */

let failures = 0

export function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   expected: ${JSON.stringify(expected)}\n   actual:   ${JSON.stringify(actual)}`}`)
}

export function done(): never {
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}
