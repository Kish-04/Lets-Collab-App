// Remote control on the host: where a controller's click lands (window shares, scaled and secondary
// displays), which application is under it, and the per-application approval state machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { loadTs } from './helpers/loadTs.mjs'

const {
  mapNormalizedToRect, resolveDisplayRect, captureFrameInset, insetRect, findWindowAt, classifyApp,
  AppApprovalPolicy, NoticeLimiter, isMinimisedRect,
} = createRequire(import.meta.url)('../remoteAppPolicy.js')
const { videoPointFromClient } = await loadTs('lib/remotePointer.ts')

test('a click at the top-left / bottom-right of the shared picture lands at the window corners', () => {
  const rect = { x: 600, y: 450, width: 1800, height: 1200 } // physical pixels at 150 %
  assert.deepEqual(mapNormalizedToRect(0, 0, rect), { x: 600, y: 450 })
  assert.deepEqual(mapNormalizedToRect(1, 1, rect), { x: 2399, y: 1649 }) // never one past the edge
  assert.deepEqual(mapNormalizedToRect(0.5, 0.5, rect), { x: 1500, y: 1050 })
  assert.deepEqual(mapNormalizedToRect(-3, 7, rect), { x: 600, y: 1649 })
  assert.equal(mapNormalizedToRect(0.5, 0.5, { x: 0, y: 0, width: 0, height: 10 }), null)
})

test('window on a secondary monitor left of the primary (negative physical coordinates)', () => {
  const rect = { x: -2560, y: 100, width: 1280, height: 720 }
  assert.deepEqual(mapNormalizedToRect(0, 0, rect), { x: -2560, y: 100 })
  assert.deepEqual(mapNormalizedToRect(0.25, 0.5, rect), { x: -2240, y: 460 })
})

test('screen shares resolve to the shared display, scaled to physical pixels on Windows', () => {
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 1.5 },
    { id: 2, bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  ]
  // Stand-in for screen.dipToScreenRect: primary scaled by 1.5, secondary placed right of it
  const dipToScreenRect = (bounds) => bounds.x === 0
    ? { x: 0, y: 0, width: bounds.width * 1.5, height: bounds.height * 1.5 }
    : { x: 1920, y: 0, width: bounds.width, height: bounds.height }
  assert.deepEqual(resolveDisplayRect({ displays, displayId: '1', platform: 'win32', dipToScreenRect }), { x: 0, y: 0, width: 1920, height: 1200 })
  const second = resolveDisplayRect({ displays, displayId: 2, platform: 'win32', dipToScreenRect })
  assert.deepEqual(second, { x: 1920, y: 0, width: 1920, height: 1080 })
  assert.deepEqual(mapNormalizedToRect(0, 0, second), { x: 1920, y: 0 })
  assert.deepEqual(resolveDisplayRect({ displays, displayId: '1', platform: 'linux' }), { x: 0, y: 0, width: 1920, height: 1200 })
  assert.deepEqual(resolveDisplayRect({ displays, displayId: '1', platform: 'darwin' }), { x: 0, y: 0, width: 1280, height: 800 })
  assert.equal(resolveDisplayRect({ displays, displayId: '9', platform: 'win32', dipToScreenRect }), null)
  assert.equal(resolveDisplayRect({ displays, displayId: '', platform: 'win32', dipToScreenRect }), null)
})

test('the invisible Windows resize border is removed using the captured frame shape', () => {
  // Visible 1200x800 window, 8 px invisible border on left/right/bottom
  const normal = { x: 92, y: 100, width: 1216, height: 808 }
  assert.deepEqual(captureFrameInset(normal, 1200, 800), { left: 8, top: 0, right: 8, bottom: 8 })
  assert.deepEqual(captureFrameInset(normal, 600, 400), { left: 8, top: 0, right: 8, bottom: 8 }) // downscaled capture
  const visible = insetRect(normal, captureFrameInset(normal, 1200, 800))
  assert.deepEqual(visible, { x: 100, y: 100, width: 1200, height: 800 })
  // Maximised: border on all four sides
  const maximised = { x: -8, y: -8, width: 1936, height: 1048 }
  assert.deepEqual(captureFrameInset(maximised, 1920, 1032), { left: 8, top: 8, right: 8, bottom: 8 })
  // Borderless window (frame shape == rect shape): nothing to remove
  assert.deepEqual(captureFrameInset({ x: 0, y: 0, width: 1000, height: 700 }, 1000, 700), { left: 0, top: 0, right: 0, bottom: 0 })
  // Nonsense frame sizes are ignored
  assert.deepEqual(captureFrameInset(normal, 300, 900), { left: 0, top: 0, right: 0, bottom: 0 })
  assert.deepEqual(captureFrameInset(normal, 0, 0), { left: 0, top: 0, right: 0, bottom: 0 })
})

const windows = {
  // id: [visible, bounds, processId, path]
  10: [true, { x: 0, y: 0, width: 400, height: 300 }, 111, 'C:\\Windows\\System32\\notepad.exe'],
  11: [false, { x: 0, y: 0, width: 4000, height: 3000 }, 222, 'C:\\hidden.exe'],
  12: [true, { x: 0, y: 0, width: 3840, height: 2160 }, 333, 'C:\\Windows\\SystemApps\\TextInputHost.exe'],
  13: [true, { x: -32000, y: -32000, width: 160, height: 28 }, 444, 'C:\\minimised.exe'],
  14: [true, { x: 100, y: 100, width: 1600, height: 900 }, 555, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  15: [true, { x: 0, y: 0, width: 3840, height: 2160 }, 666, 'C:\\Windows\\explorer.exe'],
}
const lookups = {
  isVisible: id => windows[id][0],
  getBounds: id => windows[id][1],
  describe: id => ({ processId: windows[id][2], path: windows[id][3] }),
}
const zOrder = [12, 11, 13, 10, 14, 15]

test('hit test picks the top-most visible, non-minimised window under the point', () => {
  assert.equal(findWindowAt(zOrder, 50, 50, lookups).id, 10) // notepad above chrome
  assert.equal(findWindowAt(zOrder, 500, 500, lookups).id, 14) // chrome
  assert.equal(findWindowAt(zOrder, 3000, 2000, lookups).id, 15) // desktop
  assert.equal(findWindowAt(zOrder, 150, 150, { ...lookups, skipIds: new Set([10]) }).id, 14) // click-through own overlay
  assert.equal(findWindowAt(zOrder, 9000, 9000, lookups), null)
  assert.equal(findWindowAt(zOrder, 50, 50, { ...lookups, getBounds: () => { throw new Error('gone') } }), null)
  assert.equal(isMinimisedRect({ x: -32000, y: -32000, width: 160, height: 28 }), true)
})

test('cloaked windows (lock screen, closed Start menu, taskbar previews) never take the click', () => {
  // Z-order recorded on a Windows 11 laptop (1920x1080 physical, 125 %), top first
  const real = {
    1: [true, { x: 0, y: 0, width: 166, height: 47 }, 10, 'C:\\Windows\\explorer.exe'], // taskbar preview (cloaked)
    2: [true, { x: 0, y: 0, width: 1536, height: 864 }, 11, 'C:\\Windows\\SystemApps\\TextInputHost.exe'],
    3: [true, { x: 0, y: 0, width: 1920, height: 1080 }, 12, 'C:\\Windows\\SystemApps\\LockApp.exe'],
    4: [true, { x: 561, y: 82, width: 1000, height: 998 }, 13, 'C:\\Windows\\SystemApps\\SearchHost.exe'],
    5: [true, { x: 0, y: 0, width: 1920, height: 1020 }, 14, 'C:\\Windows\\SystemApps\\StartMenuExperienceHost.exe'],
    6: [true, { x: 0, y: 1020, width: 1920, height: 60 }, 10, 'C:\\Windows\\explorer.exe'], // taskbar
    7: [true, { x: 183, y: 0, width: 1750, height: 1030 }, 15, 'C:\\Slack\\slack.exe'],
    8: [true, { x: -9, y: -9, width: 1938, height: 1038 }, 16, 'C:\\Edge\\msedge.exe'],
    9: [true, { x: 0, y: 0, width: 1920, height: 1080 }, 10, 'C:\\Windows\\explorer.exe'], // desktop
  }
  const opts = {
    isVisible: id => real[id][0], getBounds: id => real[id][1],
    describe: id => ({ processId: real[id][2], path: real[id][3] }),
    visibleIds: new Set([7, 8]), // what the screen capturer lists
    foregroundId: 8, foregroundPid: 16, ownPid: 999,
  }
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  assert.equal(findWindowAt(order, 50, 20, opts).id, 8) // Edge, not the cloaked preview or LockApp
  assert.equal(findWindowAt(order, 600, 500, opts).id, 7) // Slack above Edge
  assert.equal(findWindowAt(order, 600, 1050, opts).id, 6) // the taskbar
  // The Start menu once opened is the foreground window: it takes the click
  assert.equal(findWindowAt(order, 600, 500, { ...opts, foregroundId: 5, foregroundPid: 14 }).id, 5)
  // A menu of the foreground program (not listed by the capturer) is believed
  const withMenu = { ...real, 0: [true, { x: 500, y: 400, width: 300, height: 400 }, 16, 'C:\\Edge\\msedge.exe'] }
  assert.equal(findWindowAt([0, ...order], 600, 500, { ...opts, getBounds: id => withMenu[id][1], describe: id => ({ processId: withMenu[id][2], path: withMenu[id][3] }), isVisible: () => true }).id, 0)
  // Without a capturer list (macOS / Linux) the plain z-order is used
  assert.equal(findWindowAt(order, 600, 500, { ...opts, visibleIds: null }).id, 3)
})

test('applications are classified for approval', () => {
  const opts = { ownPid: 999, platform: 'win32' }
  assert.equal(classifyApp({ processId: 999, path: 'C:\\Apps\\Lets Collab.exe' }, opts).kind, 'own')
  const notepad = classifyApp({ processId: 1, path: 'C:\\Windows\\System32\\NOTEPAD.EXE' }, opts)
  assert.deepEqual(notepad, { key: 'c:\\windows\\system32\\notepad.exe', name: 'Notepad', kind: 'app', path: 'C:\\Windows\\System32\\NOTEPAD.EXE' })
  assert.equal(classifyApp({ processId: 2, path: 'C:\\Windows\\explorer.exe' }, opts).kind, 'shell')
  assert.equal(classifyApp({ processId: 3, path: 'D:\\Tools\\my-tool.exe' }, opts).name, 'my-tool')
  // Store apps share one host process: approving Calculator must not approve Settings
  const frame = 'C:\\Windows\\System32\\ApplicationFrameHost.exe'
  const calculator = classifyApp({ processId: 6, path: frame, title: 'Calculator' }, opts)
  const settings = classifyApp({ processId: 6, path: frame, title: 'Settings' }, opts)
  assert.equal(calculator.name, 'Calculator')
  assert.notEqual(calculator.key, settings.key)
  assert.equal(classifyApp({ processId: 4, path: '' }, opts).key, 'unknown')
  assert.equal(classifyApp(null, opts).name, 'Unknown application')
  assert.equal(classifyApp({ processId: 5, path: '/Applications/Safari.app/Contents/MacOS/Safari' }, { ownPid: 1, platform: 'darwin' }).name, 'Safari')
})

test('approval state machine: request once, hold the click, allow / deny, revoke clears', () => {
  const policy = new AppApprovalPolicy()
  const notepad = { key: 'notepad', name: 'Notepad', kind: 'app' }
  const own = { key: 'own', name: "Let's Collab", kind: 'own' }
  assert.equal(policy.check(own), 'own')
  assert.equal(policy.check(notepad, 0), 'request')
  const request = policy.request(notepad, { controllerName: 'Bob' }, { x: 1, y: 2, button: 'left', released: false }, 0)
  assert.equal(policy.check(notepad, 1), 'pending') // further input is dropped, not queued
  assert.equal(policy.request(notepad, {}, null, 2), request) // never two prompts for one app
  assert.equal(policy.markHeldButtonReleased('notepad', 'left'), true)
  assert.equal(request.held.released, true)
  const result = policy.resolve(request.id, true, false)
  assert.equal(result.allowed, true)
  assert.equal(policy.check(notepad), 'allow')
  assert.equal(policy.resolve(request.id, true), null) // answered once
  policy.reset() // revoke / share ended
  assert.equal(policy.check(notepad, 10), 'request')

  const second = policy.request(notepad, {}, null, 100)
  policy.resolve(second.id, false, false, 100)
  assert.equal(policy.check(notepad, 5000), 'denied') // no prompt flood after a denial
  assert.equal(policy.check(notepad, 100 + 10000), 'request')

  const third = policy.request(notepad, {}, null, 20000)
  policy.resolve(third.id, true, true, 20000) // "always allow for this session"
  policy.reset()
  assert.equal(policy.check(notepad), 'allow')
  policy.resetAll()
  assert.equal(policy.check(notepad, 30000), 'request')
})

test('turning the policy off allows everything except Let\'s Collab and clears pending prompts', () => {
  const policy = new AppApprovalPolicy()
  const app = { key: 'x', name: 'X', kind: 'app' }
  policy.request(app)
  assert.deepEqual(policy.setEnabled(false).length, 1)
  assert.equal(policy.check(app), 'allow')
  assert.equal(policy.check({ key: 'own', kind: 'own' }), 'own')
})

test('controller notices are rate limited per key', () => {
  const limiter = new NoticeLimiter(3000)
  assert.equal(limiter.allow('a', 0), true)
  assert.equal(limiter.allow('a', 1000), false)
  assert.equal(limiter.allow('b', 1000), true)
  assert.equal(limiter.allow('a', 3000), true)
})

test('controller pointer is normalised over the letterboxed picture, not the element', () => {
  const box = { left: 0, top: 0, width: 1600, height: 900 }
  // A 4:3 window shared into a 16:9 element: picture is 1200x900 centred, bars of 200 px each side
  assert.deepEqual(videoPointFromClient(200, 0, box, 800, 600), { x: 0, y: 0, inside: true })
  assert.deepEqual(videoPointFromClient(1400, 900, box, 800, 600), { x: 1, y: 1, inside: true })
  assert.deepEqual(videoPointFromClient(800, 450, box, 800, 600), { x: 0.5, y: 0.5, inside: true })
  assert.equal(videoPointFromClient(100, 450, box, 800, 600).inside, false)
  // No video size yet: falls back to the element box
  assert.deepEqual(videoPointFromClient(400, 450, box, 0, 0), { x: 0.25, y: 0.5, inside: true })
})
