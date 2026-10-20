// Yjs sync over simulated WebRTC data channels (whiteboard + exam code mirror): node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { loadTsFresh, repoRoot, requireLoaded } from './helpers/loadTs.mjs'

const Y = createRequire(path.join(repoRoot, 'package.json'))('yjs')
const CHANNEL = 'ircp-crdt'

function link(a, aId, b, bId) {
  const make = () => ({
    readyState: 'open', onmessage: null, onclose: null, onopen: null,
    send(data) { const other = this.peer; setTimeout(() => other.onmessage?.({ data }), 1) },
  })
  const ca = make(), cb = make()
  ca.peer = cb; cb.peer = ca
  a.dcm.attachChannel(ca, bId, CHANNEL)
  b.dcm.attachChannel(cb, aId, CHANNEL)
}

const tick = (ms = 40) => new Promise(r => setTimeout(r, ms))
const keys = doc => [...doc.getMap('elements').keys()].sort().join(',')

// Each peer gets its own CrdtSync + DataChannelManager instance, like separate browsers
function wiredPeer() {
  const crdt = loadTsFresh('lib/CrdtSync.ts')
  const { dataChannelManager } = requireLoaded('lib/DataChannelManager.ts')
  return { crdt, dcm: dataChannelManager }
}

test('whiteboard edits converge through the host and late joiners catch up', async () => {
  const host = wiredPeer(), a = wiredPeer(), b = wiredPeer()
  const hd = new Y.Doc(), ad = new Y.Doc(), bd = new Y.Doc()
  link(host, 'host', a, 'A')
  host.crdt.bindSharedDoc('whiteboard', hd, { relay: true })
  a.crdt.bindSharedDoc('whiteboard', ad)
  ad.getMap('elements').set('page-1::e1', { id: 'e1', version: 1 })
  await tick()
  b.crdt.bindSharedDoc('whiteboard', bd)
  link(host, 'host', b, 'B')
  await tick(80)
  assert.equal(bd.getMap('elements').get('page-1::e1')?.version, 1)

  bd.getMap('elements').set('page-1::e2', { id: 'e2', version: 1 })
  ad.getMap('elements').set('page-1::e3', { id: 'e3', version: 1 })
  await tick(80)
  assert.equal(keys(ad), 'page-1::e1,page-1::e2,page-1::e3')
  assert.equal(keys(bd), keys(ad))
  assert.equal(keys(hd), keys(ad))
})

test('exam code streams to the host only; candidates never see each other', async () => {
  const host = wiredPeer(), a = wiredPeer(), b = wiredPeer()
  link(host, 'host', a, 'A'); link(host, 'host', b, 'B')
  const seen = {}
  const mirror = host.crdt.observePeerDocs('exam-code', (peerId, doc) => { seen[peerId] = doc })
  const examA = new Y.Doc(), examB = new Y.Doc()
  a.crdt.bindSharedDoc('exam-code', examA)
  b.crdt.bindSharedDoc('exam-code', examB)
  examA.getText('monaco:q1').insert(0, 'print("A")')
  examB.getText('monaco:q1').insert(0, 'print("B")')
  await tick(80)
  assert.equal(seen.A.getText('monaco:q1').toString(), 'print("A")')
  assert.equal(seen.B.getText('monaco:q1').toString(), 'print("B")')
  assert.equal(examA.getText('monaco:q1').toString(), 'print("A")')
  assert.equal(examB.getText('monaco:q1').toString(), 'print("B")')

  // A reloads with an empty doc and recovers its own code from the host
  const reloaded = new Y.Doc()
  a.crdt.bindSharedDoc('exam-code', reloaded)
  await tick(80)
  assert.equal(reloaded.getText('monaco:q1').toString(), 'print("A")')
  mirror.dispose()
})

test('a supervised host board syncs only with the selected candidate', async () => {
  const host = wiredPeer(), c1 = wiredPeer(), c2 = wiredPeer()
  link(host, 'host', c1, 'C1'); link(host, 'host', c2, 'C2')
  const hostDoc = new Y.Doc(), c1Doc = new Y.Doc(), c2Doc = new Y.Doc()
  c1.crdt.bindSharedDoc('whiteboard', c1Doc)
  c2.crdt.bindSharedDoc('whiteboard', c2Doc)
  c2Doc.getMap('elements').set('page-1::secret', { id: 'secret' })
  host.crdt.bindSharedDoc('whiteboard', hostDoc, { peerId: 'C1' })
  c1Doc.getMap('elements').set('page-1::c1', { id: 'c1' })
  await tick(80)
  assert.ok(hostDoc.getMap('elements').has('page-1::c1'))
  assert.ok(!hostDoc.getMap('elements').has('page-1::secret'))
  assert.ok(!c1Doc.getMap('elements').has('page-1::secret'))
})
