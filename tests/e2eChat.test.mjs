// End-to-end chat protocol test: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './helpers/loadTs.mjs'

const { E2EChatSession, isE2EMessage } = await loadTs('lib/E2EChat.ts')
const ROOM = 'ROOM42'

async function member(id) {
  const session = new E2EChatSession(ROOM)
  return { id, session, publicKey: await session.init() }
}

async function deliver(host, shares, members) {
  for (const share of shares) {
    const target = members.find(m => m.id === share.targetId)
    await target.session.receiveKeyring(share.payload)
  }
}

test('members receive the group key and can read each other', async () => {
  const host = await member('host'), alice = await member('alice')
  const shares = await host.session.hostHandleRoster('host', [host, alice])
  await deliver(host, shares, [alice])

  const ciphertext = await alice.session.encrypt('hello from alice')
  assert.ok(isE2EMessage(ciphertext))
  assert.ok(!ciphertext.includes('hello'))
  assert.equal(await host.session.decrypt(ciphertext), 'hello from alice')
  assert.equal(await host.session.hostFingerprint(), await alice.session.hostFingerprint())
})

test('a late joiner can read history; a departed member cannot read new messages', async () => {
  const host = await member('host'), alice = await member('alice'), bob = await member('bob')
  await deliver(host, await host.session.hostHandleRoster('host', [host, alice]), [alice])
  const early = await alice.session.encrypt('before bob joined')

  await deliver(host, await host.session.hostHandleRoster('host', [host, alice, bob]), [alice, bob])
  assert.equal(await bob.session.decrypt(early), 'before bob joined')

  // Alice leaves: host rotates; bob gets the new epoch, alice does not
  await deliver(host, await host.session.hostHandleRoster('host', [host, bob]), [bob])
  const later = await bob.session.encrypt('after alice left')
  assert.equal(await host.session.decrypt(later), 'after alice left')
  assert.equal(await alice.session.decrypt(later), null)
})

test('the server (no keys) cannot decrypt, and tampering is detected', async () => {
  const host = await member('host'), alice = await member('alice')
  await deliver(host, await host.session.hostHandleRoster('host', [host, alice]), [alice])
  const ciphertext = await alice.session.encrypt('secret')

  const server = new E2EChatSession(ROOM)
  await server.init()
  assert.equal(await server.decrypt(ciphertext), null)

  const [prefix, epoch, body] = ciphertext.split(':')
  const bytes = Buffer.from(body, 'base64'); bytes[bytes.length - 1] ^= 1
  assert.equal(await host.session.decrypt(`${prefix}:${epoch}:${bytes.toString('base64')}`), null)
})

test('a keyring wrapped for one member cannot be unwrapped by another', async () => {
  const host = await member('host'), alice = await member('alice'), mallory = await member('mallory')
  const [share] = await host.session.hostHandleRoster('host', [host, alice])
  await assert.rejects(mallory.session.receiveKeyring(share.payload))
})
