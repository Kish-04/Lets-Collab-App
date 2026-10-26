// Supervised proctoring policy: sustained detection, escalation, camera-frame health and the pet queue.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/loadTs.mjs'

const {
  SustainedSignal, ProctoringEscalator, PetMessageQueue, proctoringKind, proctoringRule,
  cameraFrameProblem, lumaDifference, toLuma, suppressAudioProctoringFor, audioProctoringSuppressed,
} = await loadTs('lib/proctoringPolicy.ts')

test('a single bad frame never fires; a sustained one does, then cools down', () => {
  const signal = new SustainedSignal(1000, 0.8, 5000)
  // 100 ms samples: one positive frame in a clean second
  for (let t = 0; t <= 1000; t += 100) assert.equal(signal.update(t === 500, t), false)
  // Now positive for a full window
  let firedAt = null
  for (let t = 1100; t <= 2500; t += 100) if (signal.update(true, t) && firedAt === null) firedAt = t
  assert.ok(firedAt !== null && firedAt >= 1800, `fired at ${firedAt}`)
  // Still positive during the cooldown: quiet
  for (let t = 2600; t < firedAt + 5000; t += 100) assert.equal(signal.update(true, t), false)
  assert.equal(signal.update(true, firedAt + 5000), true)
})

test('flicker below the ratio does not fire', () => {
  const signal = new SustainedSignal(1000, 0.8, 5000)
  let fired = false
  for (let t = 0; t <= 5000; t += 100) fired = signal.update((t / 100) % 2 === 0, t) || fired
  assert.equal(fired, false)
})

test('repeats of a violation escalate penalty and severity; other kinds are counted apart', () => {
  const escalator = new ProctoringEscalator(10 * 60 * 1000)
  const first = escalator.record('look_away', undefined, 0)
  assert.equal(first.kind, 'LOOKING_AWAY')
  assert.equal(first.penalty, proctoringRule('LOOKING_AWAY').penalty)
  assert.equal(first.severity, 'medium')
  assert.equal(first.escalated, false)
  const second = escalator.record('eye_darting', undefined, 1000) // same kind under another name
  assert.equal(second.count, 2)
  assert.ok(second.penalty > first.penalty)
  const third = escalator.record('LOOKING_AWAY', undefined, 2000)
  assert.equal(third.severity, 'high')
  escalator.record('LOOKING_AWAY', undefined, 3000)
  const fifth = escalator.record('LOOKING_AWAY', undefined, 4000)
  assert.equal(fifth.severity, 'critical')
  assert.ok(fifth.penalty <= 60)
  assert.equal(escalator.record('NO_FACE', undefined, 5000).count, 1)
  // Outside the window the count starts again
  assert.equal(escalator.record('LOOKING_AWAY', undefined, 11 * 60 * 1000).count, 1)
})

test('detector event names map to one kind with a rule', () => {
  assert.equal(proctoringKind('forbidden_object'), 'PHONE_DETECTED')
  assert.equal(proctoringKind('TALKING_DETECTED'), 'VOICE_DETECTED')
  assert.equal(proctoringKind('suspicious_noise'), 'LOUD_NOISE')
  assert.equal(proctoringKind('BANNED_PROCESS'), 'REMOTE_DESKTOP')
  assert.match(proctoringRule('look_away').pet, /Looking away detected/)
  assert.equal(proctoringRule('made_up').severity, 'medium')
})

test('camera health: dark, covered (uniform) and frozen frames', () => {
  const frame = (fn) => {
    const rgba = new Uint8ClampedArray(32 * 24 * 4)
    for (let p = 0; p < 32 * 24; p++) { const v = fn(p); rgba.set([v, v, v, 255], p * 4) }
    return toLuma(rgba)
  }
  assert.equal(cameraFrameProblem(frame(() => 5)), 'dark')
  assert.equal(cameraFrameProblem(frame(() => 120)), 'uniform')
  const scene = frame(p => 60 + (p * 37) % 140)
  assert.equal(cameraFrameProblem(scene), null)
  assert.ok(lumaDifference(scene, scene) < 0.35)
  const noisy = frame(p => 60 + (p * 37) % 140 + (p % 7 === 0 ? 6 : 0))
  assert.ok(lumaDifference(scene, noisy) > 0.35, 'sensor noise is not "frozen"')
})

function fakeClock() {
  let now = 0
  const timers = []
  return {
    now: () => now,
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
    advance(ms) {
      const end = now + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const next = timers[0]
        if (!next || next.at > end) break
        timers.shift()
        now = next.at
        next.fn()
      }
      now = end
    },
  }
}

test('pet queue shows a burst one at a time and drops repeats', () => {
  const clock = fakeClock()
  const shown = []
  let clears = 0
  const queue = new PetMessageQueue({ show: t => shown.push(t), clear: () => clears++, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  assert.equal(queue.push('Asha: Looking away from the screen', 'a:LOOK'), true)
  assert.equal(queue.push('Ravi: Phone on camera', 'r:PHONE'), true)
  assert.equal(queue.push('Asha: Looking away from the screen', 'a:LOOK'), false) // repeat
  assert.deepEqual(shown, ['Asha: Looking away from the screen'])
  clock.advance(10000)
  assert.deepEqual(shown, ['Asha: Looking away from the screen', 'Ravi: Phone on camera'])
  clock.advance(10000)
  assert.equal(queue.showing, null)
  assert.ok(clears >= 2)
  // Same key again inside 20 s of the first: still dropped; after it: shown
  assert.equal(queue.push('Asha: Looking away from the screen', 'a:LOOK'), true) // 20 s since first push
  queue.dispose()
})

test('pet queue keeps the newest messages when a burst overflows', () => {
  const clock = fakeClock()
  const shown = []
  const queue = new PetMessageQueue({ show: t => shown.push(t), clear: () => {}, maxQueued: 2, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  for (let i = 0; i < 6; i++) queue.push(`m${i}`)
  clock.advance(60000)
  assert.deepEqual(shown, ['m0', 'm4', 'm5'])
})

test('the pet\'s own beeps briefly suppress audio proctoring', () => {
  suppressAudioProctoringFor(1000, 5000)
  assert.equal(audioProctoringSuppressed(5500), true)
  assert.equal(audioProctoringSuppressed(6100), false)
})
