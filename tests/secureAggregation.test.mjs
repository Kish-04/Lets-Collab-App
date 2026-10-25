// Secure aggregation with dropout recovery: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { loadTs, repoRoot } from './helpers/loadTs.mjs'

const client = await loadTs('lib/secureAggregation.ts')
const require = createRequire(import.meta.url)
const server = require(path.join(repoRoot, 'server', 'secureAggregation.js'))

const ROOM = 'ROOM1'
const ROUND = 7
const LEN = 41

async function runRound({ count, dropAfterShares = [] }) {
  const base = Array.from({ length: LEN }, (_, i) => Math.sin(i) * 0.3)
  const participants = []
  for (let i = 0; i < count; i++) {
    const keys = await client.createRoundKeys()
    participants.push({
      id: `sock-${String.fromCharCode(97 + i)}`,
      keys,
      seed: crypto.getRandomValues(new Uint8Array(32)),
      n: [12, 40, 0, 7, 25, 3][i % 6],
      delta: Array.from({ length: LEN }, () => (Math.random() - 0.5) * 0.08),
    })
  }
  const peers = participants.map(p => ({ id: p.id, publicKey: p.keys.publicKey }))

  // Stage 2: shares, relayed by the server to their recipients
  const inbox = new Map(participants.map(p => [p.id, []]))
  let threshold
  for (const p of participants) {
    const prepared = await client.prepareShares({ keys: p.keys, selfSeed: p.seed, peers, roomId: ROOM, round: ROUND })
    threshold = prepared.threshold
    prepared.shares.forEach(share => inbox.get(share.to).push({ from: p.id, ct: share.ct }))
  }

  // Stage 3: survivors open shares and submit masked vectors (dropped participants never submit)
  const survivors = participants.filter(p => !dropAfterShares.includes(p.id))
  const masked = new Map()
  for (const p of survivors) {
    p.held = await client.openShares({ keys: p.keys, received: inbox.get(p.id), peers, roomId: ROOM, round: ROUND })
    p.contribution = client.buildContribution(p.delta, p.n, 1, 0)
    const vector = await client.maskVector({ values: p.contribution, keys: p.keys, selfSeed: p.seed, selfId: p.id, peers, roomId: ROOM, round: ROUND })
    masked.set(p.id, server.decodeSubmission(vector, LEN + 1))
  }

  // Stage 4: survivors reveal b shares for survivors and s shares for dropped peers
  const survivorIds = survivors.map(p => p.id)
  const revealed = new Map()
  for (const p of survivors) {
    for (const r of client.revealShares(p.held, survivorIds, dropAfterShares)) {
      if (!revealed.has(r.owner)) revealed.set(r.owner, { kind: r.kind, shares: [] })
      revealed.get(r.owner).shares.push({ x: r.x, y: r.y })
    }
  }
  const sum = server.recoverSum({
    masked,
    dropped: dropAfterShares,
    publicKeys: new Map(peers.map(p => [p.id, p.publicKey])),
    revealed,
    threshold,
    roomId: ROOM,
    round: ROUND,
  })
  const result = server.applyAggregate(base, sum)
  const totalN = survivors.reduce((t, p) => t + p.n, 0)
  const expected = base.map((w, i) => w + survivors.reduce((t, p) => t + p.delta[i] * p.n, 0) / totalN)
  return { result, expected, totalN, masked, survivors }
}

const maxError = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))

test('aggregate equals plain weighted FedAvg when everyone submits', async () => {
  const { result, expected, totalN } = await runRound({ count: 4 })
  assert.equal(result.totalSamples, totalN)
  assert.ok(maxError(result.weights, expected) < 1e-3)
})

test('round still completes when a participant drops after sharing keys', async () => {
  const { result, expected, totalN } = await runRound({ count: 5, dropAfterShares: ['sock-b'] })
  assert.equal(result.totalSamples, totalN)
  assert.ok(maxError(result.weights, expected) < 1e-3)
})

test('a single masked submission reveals nothing about its plaintext', async () => {
  const { masked, survivors } = await runRound({ count: 3 })
  const p = survivors[0]
  const plain = Array.from(p.contribution, v => Math.round(v * server.FIXED_POINT_SCALE) >>> 0)
  assert.equal(plain.filter((v, i) => v === masked.get(p.id)[i]).length, 0)
})

test('a participant refuses to reveal both kinds of share for the same peer', () => {
  const held = new Map([['sock-a', { x: 1, s: 'AA==', b: 'AA==' }]])
  assert.throws(() => client.revealShares(held, ['sock-a'], ['sock-a']))
})

test('updates are clipped to L2 norm 1 so the fixed-point sum cannot overflow', () => {
  const big = client.buildContribution(Array(LEN).fill(5), 10, 1, 0)
  const norm = Math.sqrt(Array.from(big).slice(0, LEN).reduce((t, v) => t + (v / 10) ** 2, 0))
  assert.ok(Math.abs(norm - 1) < 1e-9)
})
