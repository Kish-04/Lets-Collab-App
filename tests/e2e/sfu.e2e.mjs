// Exam media server (SFU) end to end: a supervised candidate's camera reaches an admin's exam wall
// through mediasoup, with real decoded video frames. Same harness as session.e2e.mjs.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { repoRoot } from '../helpers/loadTs.mjs'

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'e2e_test_jwt_secret_with_more_than_32_characters',
  MONGO_URI: 'mongodb://127.0.0.1:1/e2e',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-sfu-e2e-${Date.now()}.json`),
  SFU_ENABLED: 'true',
  SFU_LISTEN_IP: '127.0.0.1',
  SFU_RTC_MIN_PORT: '41000',
  SFU_RTC_MAX_PORT: '41100',
})

const rootRequire = createRequire(path.join(repoRoot, 'package.json'))
const serverRequire = createRequire(path.join(repoRoot, 'server', 'index.js'))
const puppeteer = rootRequire('puppeteer')
const { server } = serverRequire('./index.js')
const mockStore = serverRequire('./mockStore.js')
const { signJwt } = serverRequire('./config.js')
const sfu = serverRequire('./sfu.js')

const FRONTEND_PORT = 3108
let frontendUrl = process.env.E2E_FRONTEND_URL
let backendUrl
let nextProcess
let browser
let adminBrowser

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).status < 500) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`${url} did not come up`)
}

function account(name, role = 'user') {
  const user = mockStore.createUser({ name, email: `${name.toLowerCase()}-${Date.now()}@e2e.local`, password: 'x', isVerified: true, role })
  return { ...user, token: signJwt({ id: user._id }) }
}

async function pageAs(user, inBrowser = browser) {
  const context = await inBrowser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', err => console.log(`[${user.name} page error]`, err.message))
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[${user.name} console]`, msg.text()) })
  await page.evaluateOnNewDocument((u, backend) => {
    localStorage.setItem('ircp_user', JSON.stringify({ token: u.token, name: u.name, email: u.email, role: u.role }))
    localStorage.setItem('ircp_name', u.name)
    localStorage.setItem('ircp_backend_url', backend)
    localStorage.setItem('ircp_role', u.role) // the admin pages gate on this
  }, { token: user.token, name: user.name, email: user.email, role: user.role }, backendUrl)
  return page
}

const textOnPage = (page, text, timeout = 30000) =>
  page.waitForFunction(t => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text)

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  backendUrl = `http://127.0.0.1:${server.address().port}`
  if (!frontendUrl) {
    frontendUrl = `http://localhost:${FRONTEND_PORT}`
    // Use 'next start' (pre-built) in CI to avoid on-demand compilation delays.
    // Set E2E_NEXT_MODE=start after running `next build` in the CI step.
    const useStart = process.env.E2E_NEXT_MODE === 'start'
    const nextCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    const nextArgs = useStart
      ? ['next', 'start', '-p', String(FRONTEND_PORT)]
      : ['next', 'dev', '-p', String(FRONTEND_PORT)]
    const nextEnv = useStart
      ? { ...process.env, NODE_ENV: 'production' }
      : { ...process.env, NODE_ENV: 'development' }
    nextProcess = spawn(nextCmd, nextArgs, {
      cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32', env: nextEnv,
    })
  }
  // next start is ready in ~5 s; next dev may take minutes on a cold runner
  const httpTimeout = process.env.E2E_NEXT_MODE === 'start' ? 30000 : 300000
  await waitForHttp(`${frontendUrl}/session`, httpTimeout)
  const launch = () => puppeteer.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })
  // The admin gets a browser of its own: a new page in the candidate's browser takes focus from the
  // candidate, which the supervised focus policy counts as leaving the exam.
  ;[browser, adminBrowser] = await Promise.all([launch(), launch()])
})

after(async () => {
  await browser?.close()
  await adminBrowser?.close()
  server.close()
  if (nextProcess) {
    // Synchronous tree kill: the npx/shell wrapper on Windows would otherwise leave next dev running
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(nextProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    else nextProcess.kill('SIGTERM')
  }
  await serverRequire('mongoose').disconnect().catch(() => {})
  setTimeout(() => process.exit(0), 300).unref()
})

test('a supervised candidate camera reaches the admin exam wall through the media server', { timeout: 600000 }, async () => {
  const host = await pageAs(account('SfuHost'))
  const candidate = await pageAs(account('SfuCandidate'))
  // Record the candidate's camera history for the failure diagnostics: each open, failure and end
  await candidate.evaluateOnNewDocument(() => {
    const events = window.__cameraEvents = []
    const note = text => events.push(`${(performance.now() / 1000).toFixed(1)}s ${text}`)
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
    if (!getUserMedia) return
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      try {
        const stream = await getUserMedia(constraints)
        for (const track of stream.getTracks()) {
          note(`opened ${track.kind} ${track.id.slice(0, 8)}`)
          track.addEventListener('ended', () => note(`ended by the browser: ${track.kind} ${track.id.slice(0, 8)}`))
        }
        return stream
      } catch (err) {
        note(`getUserMedia ${JSON.stringify(constraints)} failed: ${err.name} ${err.message}`)
        throw err
      }
    }
  })
  const admin = await pageAs(account('SfuAdmin', 'admin'), adminBrowser)

  await host.goto(`${frontendUrl}/session?create=true&mode=supervised`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  const roomCode = await host.waitForFunction(() => window._roomCode?.current || null, { timeout: 300000 }).then(h => h.jsonValue())

  await candidate.goto(`${frontendUrl}/session?room=${roomCode}`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  // Under next dev the button can show before the page is hydrated and the click is lost: click
  // again until the host sees the request
  const joinDeadline = Date.now() + 180000
  for (;;) {
    await candidate.locator('::-p-text(Join Room)').setTimeout(120000).click()
    if (await textOnPage(host, 'SfuCandidate', 15000).then(() => true, () => false)) break
    if (Date.now() > joinDeadline) throw new Error('the host never saw the candidate ask to join')
  }
  await host.locator('::-p-text(Approve)').setTimeout(120000).click()
  await candidate.waitForFunction(() => {
    const pc = window._pc
    return pc && ['connected', 'completed'].includes(pc.connectionState)
  }, { timeout: 300000 })

  // The candidate's session activity log, without the repeated connection-quality lines
  const candidateLog = async () => {
    await candidate.evaluate(() => document.querySelector('[aria-label="Toggle Session Activity"]')?.click()).catch(() => {})
    const text = await candidate.evaluate(() => document.querySelector('[aria-label="Session activity"]')?.innerText || '(no panel)').catch(() => '(page gone)')
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/Active Pair|^(SYSTEM|QUALITY|AI|[0-9:]+)$/.test(line)).slice(0, 40).join(' | ')
  }
  // What the candidate's page holds: its server connection, the call to the host, the cameras
  const candidateState = () => candidate.evaluate(async () => {
    const tracks = list => list.map(t => `${t.kind}:${t.readyState}${t.enabled ? '' : ':disabled'}`).join(',') || 'none'
    const pc = window._pc
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || []
    return {
      socket: window._socket ? `${window._socket.connected ? 'connected' : 'disconnected'} ${window._socket.id || ''}` : 'none',
      call: pc ? `${pc.connectionState}/${pc.signalingState}, sending ${tracks(pc.getSenders().map(s => s.track).filter(Boolean))}` : 'none',
      videos: Array.from(document.querySelectorAll('video')).map(v => `${v.videoWidth}x${v.videoHeight} ready=${v.readyState} ${v.srcObject ? tracks(v.srcObject.getTracks()) : 'no stream'}`),
      cameras: devices.filter(d => d.kind === 'videoinput').length,
      cameraEvents: window.__cameraEvents || [],
    }
  }).then(state => JSON.stringify(state, null, 2)).catch(err => `(could not read: ${err.message})`)
  const printDiagnostics = async () => {
    console.log('[sfu] candidate log:', await candidateLog())
    console.log('[sfu] candidate state:', await candidateState())
    console.log('[sfu] media server producers:', JSON.stringify(sfu.listProducers(roomCode)))
  }
  // The camera reaches the media server. Then the candidate's connection drops and comes back: the
  // server closes the stream with the old socket, and the page has to send the camera again.
  const cameraPublished = async (label) => {
    const deadline = Date.now() + 240000
    while (!sfu.listProducers(roomCode).some(p => p.kind === 'video' && String(p.name).includes('SfuCandidate'))) {
      if (Date.now() > deadline) {
        await printDiagnostics()
        throw new Error(`candidate camera not on the media server (${label})`)
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  await cameraPublished('first join')
  // Close the transport under Socket.IO, as a network drop does; it reconnects by itself
  await candidate.evaluate(() => window._socket.io.engine.close())
  await new Promise(resolve => setTimeout(resolve, 1000))
  await cameraPublished('after reconnecting')

  // The admin opens the exam wall and picks this exam
  await admin.goto(`${frontendUrl}/admin/wall`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await admin.locator(`::-p-text(${roomCode})`).setTimeout(120000).click()

  // A tile appears and its video element decodes real frames from the fake camera
  await admin.waitForFunction(() => {
    const video = document.querySelector('figure video')
    return video && video.videoWidth > 0 && video.readyState >= 2
  }, { timeout: 240000 }).catch(async (err) => {
    // Say why: the wall's own status line, then the candidate's log and state
    console.log('[sfu] wall status:', await admin.evaluate(() => document.querySelector('[role=status]')?.innerText || '(none)'))
    await printDiagnostics()
    throw err
  })
  const advancing = await admin.evaluate(async () => {
    const video = document.querySelector('figure video')
    const start = video.currentTime
    await new Promise(resolve => setTimeout(resolve, 1500))
    return video.currentTime > start
  })
  assert.equal(advancing, true, 'the wall plays live video, not a frozen frame')
  assert.match(await admin.evaluate(() => document.querySelector('figure figcaption').innerText), /SfuCandidate/)
})
