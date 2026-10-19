// The signed, hash-linked audit chain detects tampering without the blockchain (server/auditChain.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const { appendToChain, verifyChain, publicKeyPem } = createRequire(import.meta.url)('../server/auditChain.js')

function chainOf(...types) {
  const anchors = []
  types.forEach((eventType, i) => {
    const anchor = { eventType, dataHash: crypto.createHash('sha256').update(`${eventType}-${i}`).digest('hex'), createdAt: new Date(1_700_000_000_000 + i).toISOString() }
    appendToChain(anchors, anchor)
    anchors.push(anchor)
  })
  return anchors
}

test('an untouched chain verifies, also against the published public key', () => {
  const anchors = chainOf('ROOM_CREATED', 'USER_JOINED', 'AI_ANTI_CHEAT_ALERT', 'SESSION_ARCHIVED')
  assert.equal(verifyChain(anchors).status, 'intact')
  assert.equal(verifyChain(anchors, publicKeyPem).length, 4)
  assert.equal(verifyChain([]).status, 'unsigned')
})

test('editing, removing, reordering or inserting anchors breaks the chain', () => {
  const edited = chainOf('ROOM_CREATED', 'AI_ANTI_CHEAT_ALERT', 'SESSION_ARCHIVED')
  edited[1].dataHash = '0'.repeat(64)
  assert.deepEqual([verifyChain(edited).status, verifyChain(edited).brokenAt], ['broken', 1])

  const removed = chainOf('ROOM_CREATED', 'AI_ANTI_CHEAT_ALERT', 'SESSION_ARCHIVED')
  removed.splice(1, 1)
  assert.match(verifyChain(removed).reason, /removed|reordered/)

  const reordered = chainOf('ROOM_CREATED', 'USER_JOINED', 'SESSION_ARCHIVED')
  ;[reordered[1], reordered[2]] = [reordered[2], reordered[1]]
  assert.equal(verifyChain(reordered).status, 'broken')

  const relabelled = chainOf('ROOM_CREATED', 'AI_ANTI_CHEAT_ALERT')
  relabelled[1].eventType = 'USER_JOINED' // hide what the event was
  assert.match(verifyChain(relabelled).reason, /changed/)
})

test('a chain re-signed with another key is rejected', () => {
  const anchors = chainOf('ROOM_CREATED', 'SESSION_ARCHIVED')
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
  assert.match(verifyChain(anchors, other).reason, /signature/)
})
