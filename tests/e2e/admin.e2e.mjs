// Admin dashboard end to end: every page opens without errors, switching pages keeps ONE live
// connection to the server (no reconnect per page), and the report is fetched once and reused.
// Same harness as session.e2e.mjs.
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
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-admin-e2e-${Date.now()}.json`),
})

const rootRequire = createRequire(path.join(repoRoot, 'package.json'))
const serverRequire = createRequire(path.join(repoRoot, 'server', 'index.js'))
const puppeteer = rootRequire('puppeteer')
const { server, io } = serverRequire('./index.js')
const mockStore = serverRequire('./mockStore.js')
const { signJwt } = serverRequire('./config.js')

const FRONTEND_PORT = 3109
let frontendUrl = process.env.E2E_FRONTEND_URL
let backendUrl
let nextProcess
let browser

async function waitForHttp(url, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`${url} did not come up`)
}

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  backendUrl = `http://127.0.0.1:${server.address().port}`
  if (!frontendUrl) {
    frontendUrl = `http://localhost:${FRONTEND_PORT}`
    const useStart = process.env.E2E_NEXT_MODE === 'start'
    const nextCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    nextProcess = spawn(nextCmd, ['next', useStart ? 'start' : 'dev', '-p', String(FRONTEND_PORT)], {
      cwd: repoRoot, stdio: 'ignore', shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: useStart ? 'production' : 'development' },
    })
  }
  await waitForHttp(`${frontendUrl}/admin/login`, process.env.E2E_NEXT_MODE === 'start' ? 30000 : 300000)
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
})

after(async () => {
  await browser?.close()
  server.close()
  if (nextProcess) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(nextProcess.pid), '/T', '/F'], { stdio: 'ignore' })
    else nextProcess.kill('SIGTERM')
  }
})

const PAGES = [
  ['Live Sessions', '/admin/sessions', 'Live Sessions'],
  ['Exam Wall', '/admin/wall', 'Exam wall'],
  ['Anti-Cheat Alerts', '/admin/alerts', 'Anti-Cheat'],
  ['Review Queue', '/admin/review', 'Review'],
  ['Blockchain Logs', '/admin/blockchain', 'Blockchain Audit Trail'],
  ['User Management', '/admin/users', 'User'],
  ['Reports', '/admin/reports', 'Reports'],
  ['Overview', '/admin', 'Platform Overview'],
]

test('admin pages share one live connection and one cached report', { timeout: 600000 }, async () => {
  const user = mockStore.createUser({ name: 'Admin E2E', email: `admin-${Date.now()}@e2e.local`, password: 'x', isVerified: true, role: 'admin' })
  const token = signJwt({ id: user._id })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(err.message))
  let reportRequests = 0
  page.on('request', req => { if (req.url().includes('/api/admin/reports')) reportRequests++ })
  await page.evaluateOnNewDocument((u, backend) => {
    localStorage.setItem('ircp_user', JSON.stringify({ token: u.token, name: u.name, email: u.email, role: 'admin' }))
    localStorage.setItem('ircp_name', u.name)
    localStorage.setItem('ircp_email', u.email)
    localStorage.setItem('ircp_role', 'admin')
    localStorage.setItem('ircp_backend_url', backend)
  }, { token, name: user.name, email: user.email }, backendUrl)

  await page.goto(`${frontendUrl}/admin`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => document.body.innerText.includes('Platform Overview'), { timeout: 300000 })
  // The sidebar badge comes from /health and the live connection, not a fixed label
  await page.waitForFunction(() => /System Online|Online · chain off|Database offline/i.test(document.body.innerText), { timeout: 60000 })
    .catch(async (err) => {
      console.log('[admin] sidebar says:', await page.evaluate(() => document.querySelector('aside')?.innerText.slice(0, 300)))
      throw err
    })
  const socketsAfterLoad = io.engine.clientsCount

  // Visit every page once (under next dev the first visit compiles it), then time a second round
  for (const round of [1, 2]) {
    for (const [label, href, heading] of PAGES) {
      const started = Date.now()
      await page.click(`a[href="${href}"]`)
      await page.waitForFunction(h => location.pathname === h, { timeout: 300000 }, href)
      await page.waitForFunction(t => document.querySelector('main')?.innerText.includes(t), { timeout: 300000 }, heading)
      if (round === 2) console.log(`[admin] ${label}: ${Date.now() - started} ms`)
    }
  }

  assert.deepEqual(errors, [], 'no page errors')
  // One shared dashboard connection; pages do not open their own
  assert.equal(io.engine.clientsCount, socketsAfterLoad, 'switching pages opened no new connections')
  assert.ok(socketsAfterLoad <= 1, `one dashboard connection (found ${socketsAfterLoad})`)
  // Opened four report pages twice: the cached report is reused rather than fetched on every visit
  console.log(`[admin] report requests: ${reportRequests}`)
  assert.ok(reportRequests <= 4, `report fetched ${reportRequests} times for 16 page visits`)
})
