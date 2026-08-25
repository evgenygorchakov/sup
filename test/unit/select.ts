import { check, done } from '../lib/check.ts'
import { applyKeys, readKeys } from '../../src/ui/interactive/select.ts'

const UP = '\x1B[A'
const DOWN = '\x1B[B'
const SS3_UP = '\x1BOA'
const ENTER = '\r'
const ESC = '\x1B'
const CTRL_C = '\x03'

const keysOf = (buffer: string): string[] => readKeys(buffer).keys
const restOf = (buffer: string): string => readKeys(buffer).rest

check('a single arrow', readKeys(DOWN), { keys: [DOWN], rest: '' })
check('SS3 arrows too', readKeys(SS3_UP), { keys: [SS3_UP], rest: '' })
check('Enter', readKeys(ENTER), { keys: [ENTER], rest: '' })
check('a plain letter', readKeys('j'), { keys: ['j'], rest: '' })
check('Ctrl+C', readKeys(CTRL_C), { keys: [CTRL_C], rest: '' })

check('two arrows in one chunk', keysOf(DOWN + DOWN), [DOWN, DOWN])
check('five arrows in one chunk', keysOf(DOWN.repeat(5)).length, 5)
check('an arrow and the Enter behind it', keysOf(DOWN + ENTER), [DOWN, ENTER])
check('letters run together', keysOf('jjk'), ['j', 'j', 'k'])
check('mixed sequence and letter', keysOf(DOWN + 'q'), [DOWN, 'q'])

check('an Esc alone waits', readKeys(ESC), { keys: [], rest: ESC })
check('a half-read CSI waits', readKeys('\x1B['), { keys: [], rest: '\x1B[' })
check('and finishes once the rest arrives', keysOf('\x1B[' + 'B'), [DOWN])
check('what came before the cut is kept', readKeys(DOWN + '\x1B['), { keys: [DOWN], rest: '\x1B[' })
check('a CSI with parameters is one key', keysOf('\x1B[1;5A'), ['\x1B[1;5A'])
check('an unfinished parameterised CSI waits', restOf('\x1B[1;5'), '\x1B[1;5')

check('Alt+x yields nothing', readKeys('\x1Bx'), { keys: [], rest: '' })
check('and does not swallow what follows', keysOf('\x1Bx' + DOWN), [DOWN])

check('down moves', applyKeys([DOWN], 0, 3), { kind: 'open', index: 1 })
check('up moves', applyKeys([UP], 2, 3), { kind: 'open', index: 1 })
check('up from the top wraps', applyKeys([UP], 0, 3), { kind: 'open', index: 2 })
check('down from the bottom wraps', applyKeys([DOWN], 2, 3), { kind: 'open', index: 0 })
check('two downs move twice', applyKeys([DOWN, DOWN], 0, 3), { kind: 'open', index: 2 })
check('j and k move like the arrows', applyKeys(['j', 'j', 'k'], 0, 3), { kind: 'open', index: 1 })
check('an unknown key changes nothing', applyKeys(['\x1B[5~'], 1, 3), { kind: 'open', index: 1 })
check('no keys at all changes nothing', applyKeys([], 1, 3), { kind: 'open', index: 1 })

check('Enter confirms where the arrows left it', applyKeys(keysOf(DOWN + ENTER), 0, 3), { kind: 'confirmed', index: 1 })
check('two arrows then Enter', applyKeys(keysOf(DOWN + DOWN + ENTER), 0, 3), { kind: 'confirmed', index: 2 })
check('Enter alone confirms the current one', applyKeys([ENTER], 2, 3), { kind: 'confirmed', index: 2 })
check('q cancels', applyKeys(['q'], 1, 3), { kind: 'cancelled' })
check('Ctrl+C cancels', applyKeys([DOWN, CTRL_C], 0, 3), { kind: 'cancelled' })

check('keys after Enter are not read', applyKeys(keysOf(ENTER + DOWN + DOWN), 0, 3), { kind: 'confirmed', index: 0 })
check('keys after a cancel are not read', applyKeys(keysOf('q' + ENTER), 0, 3), { kind: 'cancelled' })

check('no choices cancels', applyKeys([ENTER], 0, 0), { kind: 'cancelled' })

done()
