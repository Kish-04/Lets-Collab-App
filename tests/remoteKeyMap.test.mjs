// Remote keyboard input reaches robotjs with names it accepts (main.js execute-input).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { mapBrowserKeyToRobotJS: map, mapModifiers } = createRequire(import.meta.url)('../remoteKeyMap.js')

test('Ctrl uses the robotjs name "control"', () => {
  assert.deepEqual(mapModifiers({ ctrl: true, shift: true }), ['shift', 'control'])
  assert.deepEqual(mapModifiers(null), [])
})

test('letters, digits and named keys', () => {
  assert.equal(map('a', 'KeyA'), 'a')
  assert.equal(map('A', 'KeyA'), 'a') // Shift travels as a modifier
  assert.equal(map('!', 'Digit1'), '1')
  assert.equal(map('ArrowUp', 'ArrowUp'), 'up')
  assert.equal(map('Enter', 'Enter'), 'enter')
  assert.equal(map(' ', 'Space'), 'space')
  assert.equal(map('Insert', 'Insert'), 'insert')
  assert.equal(map('Meta', 'MetaLeft'), 'command') // the Windows key reaches the host
  assert.deepEqual(mapModifiers({ meta: true }), ['command']) // ...and Win+R etc. as a combo
})

test('punctuation needed to type code', () => {
  const cases = { Semicolon: ';', BracketLeft: '[', BracketRight: ']', Period: '.', Slash: '/', Comma: ',', Quote: "'", Minus: '-', Equal: '=', Backslash: '\\', Backquote: '`' }
  for (const [code, expected] of Object.entries(cases)) assert.equal(map('x', code), expected, code)
  assert.equal(map('{', 'BracketLeft'), '[') // Shift+[ -> "{" on the host
})

test('function keys and the numpad', () => {
  assert.equal(map('F5', 'F5'), 'f5')
  assert.equal(map('F12', 'F12'), 'f12')
  assert.equal(map('7', 'Numpad7'), 'numpad_7')
  assert.equal(map('+', 'NumpadAdd'), 'numpad_+')
})

test('unknown keys map to nothing', () => {
  assert.equal(map('Dead', ''), null)
  assert.equal(map('Unidentified', 'Unidentified'), null)
})
