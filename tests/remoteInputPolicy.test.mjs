// The host refuses system key combos from a remote controller (main.js execute-input).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { isBlockedRemoteKey } = createRequire(import.meta.url)('../remoteInputPolicy.js')
const down = (key, modifiers = {}, code = '') => ({ type: 'keydown', key, code, modifiers })

test('combos that run commands or escape the shared window are blocked', () => {
  for (const payload of [
    down('r', { meta: true }, 'KeyR'),          // Win+R: Run box
    down('x', { meta: true }, 'KeyX'),          // Win+X
    down('Meta', {}, 'MetaLeft'),               // Start menu
    down('OS', {}, 'OSLeft'),
    down('Tab', { alt: true }),                 // Alt+Tab
    down('F4', { alt: true }),                  // Alt+F4
    down('Escape', { ctrl: true, shift: true }), // Task Manager
    down('Escape', { ctrl: true }),             // Start menu
    down('Escape', { alt: true }),
  ]) assert.equal(isBlockedRemoteKey(payload), true, JSON.stringify(payload))
})

test('normal typing, shortcuts and key releases still go through', () => {
  for (const payload of [
    down('a'), down('Enter'), down('Tab'), down('Escape'),
    down('c', { ctrl: true }, 'KeyC'), down('s', { ctrl: true }), down('Z', { ctrl: true, shift: true }),
    down('ArrowLeft', { shift: true }),
    { type: 'keyup', key: 'r', modifiers: { meta: true } },
    { type: 'mousedown', x: 0.5, y: 0.5 },
  ]) assert.equal(isBlockedRemoteKey(payload), false, JSON.stringify(payload))
})
