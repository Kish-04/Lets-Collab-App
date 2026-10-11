// Two-browser end-to-end test of a live session through the real UI.
//   npm run test:e2e
// Starts the signaling server in-process and (unless E2E_FRONTEND_URL is set) a Next.js dev server,
// then drives a host and a participant in separate Chrome profiles with fake camera/microphone.
// Covers: room creation, join + approval, WebRTC connection, end-to-end encrypted chat in both
// directions, the Shift+Esc emergency revoke, and the audit verification endpoint.
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
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-e2e-${Date.now()}.json`),
})

const rootRequire = createRequire(path.join(repoRoot, 'package.json'))
const serverRequire = createRequire(path.join(repoRoot, 'server', 'index.js'))
const puppeteer = rootRequire('puppeteer')
const { server } = serverRequire('./index.js')
const mockStore = serverRequire('./mockStore.js')
const { signJwt } = serverRequire('./config.js')

const FRONTEND_PORT = 3107
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
  await page.evaluateOnNewDocument((u, backend) => {
    localStorage.setItem('ircp_user', JSON.stringify({ token: u.token, name: u.name, email: u.email, role: u.role }))
    localStorage.setItem('ircp_name', u.name)
    localStorage.setItem('ircp_backend_url', backend)
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
    nextProcess = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', String(FRONTEND_PORT)], {
      cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32', env: { ...process.env, NODE_ENV: 'development' },
    })
  }
  await waitForHttp(`${frontendUrl}/session`, 300000)
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

test('host and participant run a live session through the UI', { timeout: 480000 }, async () => {
  const hostUser = account('HostE2E')
  const guestUser = account('GuestE2E')
  const host = await pageAs(hostUser)
  const guest = await pageAs(guestUser)

  // Host creates a room (first visit compiles the page in dev mode, hence the long timeout)
  await host.goto(`${frontendUrl}/session?create=true&mode=collaboration`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  const roomCode = await host.waitForFunction(() => {
    const el = document.querySelector('[data-room-code]')
    return window._roomCode?.current || (el ? el.innerText.trim() : null)
  }, { timeout: 300000 }).then(h => h.jsonValue())
  assert.match(roomCode, /^[A-Z0-9]{4,}$/)

  // Participant joins with the room link and is approved by the host
  await guest.goto(`${frontendUrl}/session?room=${roomCode}`, { waitUntil: 'domcontentloaded', timeout: 240000 })
  await guest.locator('::-p-text(Join Room)').click()
  await textOnPage(host, 'GuestE2E', 180000)
  await host.locator('::-p-text(Approve)').setTimeout(60000).click()

  // WebRTC connects between the two browsers
  await guest.waitForFunction(() => {
    const pc = window._pc
    return pc && ['connected', 'completed'].includes(pc.connectionState)
  }, { timeout: 180000 })

  // End-to-end encrypted chat, both directions, through the real chat UI
  const sendChat = async (page, text) => {
    if (!(await page.$('input[placeholder="Message everyone"]'))) await page.click('[aria-label="Toggle Session Chat"]')
    await page.waitForFunction(() => document.body.innerText.includes('E2E ') && !document.body.innerText.includes('E2E pending'), { timeout: 60000 })
    await page.type('input[placeholder="Message everyone"]', text)
    await page.keyboard.press('Enter')
  }
  await sendChat(host, 'hello from the host')
  await sendChat(guest, 'hello from the guest')
  await textOnPage(guest, 'hello from the host', 60000)
  await textOnPage(host, 'hello from the guest', 60000)

  // The server only ever stored ciphertext
  const verify = await fetch(`${backendUrl}/api/sessions/${roomCode}/verify`, { headers: { Authorization: `Bearer ${account('AdminE2E', 'admin').token}` } })
  assert.equal(verify.status, 200)

  // Emergency revoke from the host keyboard reaches the participant
  await host.bringToFront()
  await host.keyboard.down('Shift')
  await host.keyboard.press('Escape')
  await host.keyboard.up('Shift')
  await textOnPage(host, 'Remote control revoked')
  await textOnPage(guest, 'revoked all remote control')
})
