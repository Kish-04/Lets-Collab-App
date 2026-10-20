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

const FRONTEND_PORT = 3108
let frontendUrl = process.env.E2E_FRONTEND_URL
let backendUrl
let nextProcess
let browser

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

async function pageAs(user) {
  const context = await browser.createBrowserContext()
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
  browser = await puppeteer.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })
})

after(async () => {
  await browser?.close()
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
  const admin = await pageAs(account('SfuAdmin', 'admin'))

  await host.goto(`${frontendUrl}/session?create=true&mode=supervised`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  const roomCode = await host.waitForFunction(() => window._roomCode?.current || null, { timeout: 300000 }).then(h => h.jsonValue())

  await candidate.goto(`${frontendUrl}/session?room=${roomCode}`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await candidate.locator('::-p-text(Join Room)').setTimeout(120000).click()
  await textOnPage(host, 'SfuCandidate', 120000)
  await host.locator('::-p-text(Approve)').setTimeout(120000).click()
  await candidate.waitForFunction(() => {
    const pc = window._pc
    return pc && ['connected', 'completed'].includes(pc.connectionState)
  }, { timeout: 300000 })

  // The admin opens the exam wall and picks this exam
  await admin.goto(`${frontendUrl}/admin/wall`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await admin.locator(`::-p-text(${roomCode})`).setTimeout(120000).click()

  // A tile appears and its video element decodes real frames from the fake camera
  await admin.waitForFunction(() => {
    const video = document.querySelector('figure video')
    return video && video.videoWidth > 0 && video.readyState >= 2
  }, { timeout: 120000 })
  const advancing = await admin.evaluate(async () => {
    const video = document.querySelector('figure video')
    const start = video.currentTime
    await new Promise(resolve => setTimeout(resolve, 1500))
    return video.currentTime > start
  })
  assert.equal(advancing, true, 'the wall plays live video, not a frozen frame')
  assert.match(await admin.evaluate(() => document.querySelector('figure figcaption').innerText), /SfuCandidate/)
})
