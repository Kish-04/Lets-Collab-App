// Screen-share / camera capture limits and WebRTC sender settings (lib/mediaTuning.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/loadTs.mjs'

const { videoSenderPlan, tuneVideoSenders, cameraConstraints, SCREEN_CONSTRAINTS } = await loadTs('lib/mediaTuning.ts')

test('screen share is capped at 1080p / 30 fps; cameras at 30 fps', () => {
  assert.equal(SCREEN_CONSTRAINTS.video.width.max, 1920)
  assert.equal(SCREEN_CONSTRAINTS.video.frameRate.max, 30)
  assert.equal(cameraConstraints(false).frameRate.max, 30)
  assert.equal(cameraConstraints(true).width.ideal, 640)
})

test('remote control trades sharp text for frame rate', () => {
  const text = videoSenderPlan('screen', false)
  const control = videoSenderPlan('screen', true)
  assert.equal(text.contentHint, 'detail')
  assert.equal(text.degradationPreference, 'maintain-resolution')
  assert.equal(control.contentHint, 'motion')
  assert.equal(control.degradationPreference, 'maintain-framerate')
  assert.equal(videoSenderPlan('camera', true).contentHint, undefined)
})

function fakeSender(track, encodings = [{}]) {
  let params = { encodings: encodings.map(e => ({ ...e })) }
  const calls = []
  return {
    track, calls,
    getParameters: () => JSON.parse(JSON.stringify(params)),
    setParameters: async (next) => { calls.push(next); params = next },
  }
}

test('senders get the plan once negotiated, and are not touched again when nothing changed', async () => {
  const screenTrack = { kind: 'video', contentHint: '' }
  const cameraTrack = { kind: 'video', contentHint: '' }
  const screen = fakeSender(screenTrack)
  const camera = fakeSender(cameraTrack)
  const unnegotiated = fakeSender({ kind: 'video', contentHint: '' }, [])
  const audio = fakeSender({ kind: 'audio' })
  const pc = { signalingState: 'stable', getSenders: () => [screen, camera, unnegotiated, audio] }
  await tuneVideoSenders(pc, t => t === screenTrack, true)
  assert.equal(screenTrack.contentHint, 'motion')
  assert.equal(cameraTrack.contentHint, '')
  assert.equal(screen.calls[0].degradationPreference, 'maintain-framerate')
  assert.equal(screen.calls[0].encodings[0].maxFramerate, 30)
  assert.equal(camera.calls[0].degradationPreference, 'balanced')
  assert.equal(unnegotiated.calls.length, 0)
  assert.equal(audio.calls.length, 0)
  await tuneVideoSenders(pc, t => t === screenTrack, true)
  assert.equal(screen.calls.length, 1, 'no second setParameters for the same plan')
  // Control revoked: back to sharp text
  await tuneVideoSenders(pc, t => t === screenTrack, false)
  assert.equal(screenTrack.contentHint, 'detail')
  assert.equal(screen.calls[1].degradationPreference, 'maintain-resolution')
})
