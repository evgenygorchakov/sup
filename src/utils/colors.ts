import process from 'node:process'

const RESET_CODE = '\x1B[0m'
const colorsEnabled = process.stderr.isTTY

function createColorizer(ansiCode: string): (text: string) => string {
  if (!colorsEnabled) {
    return text => text
  }

  return text => `\x1B[${ansiCode}m${text}${RESET_CODE}`
}

export const bold = createColorizer('1')
export const gray = createColorizer('90')
export const red = createColorizer('31')
export const green = createColorizer('32')
export const yellow = createColorizer('33')
export const blue = createColorizer('34')
export const cyan = createColorizer('36')
export const brightGreen = createColorizer('92')
export const brightBlue = createColorizer('94')
