// Tamper-evident audit log that does not depend on the blockchain.
//
// Every anchor in a room is linked to the previous one: link = { seq, prev, eventType, dataHash,
// createdAt }, hash = SHA-256 of that link (canonical JSON), and the server signs the hash with an
// Ed25519 key. Changing, removing, reordering or inserting an anchor breaks the hashes or the
// signatures, and anyone holding the public key (GET /api/audit/public-key) can check a session
// offline. The on-chain anchoring stays as an optional extra: it proves *when* a log existed.
//
// Key: AUDIT_SIGNING_KEY (an Ed25519 private key in PKCS#8 PEM, "\n" may be escaped). Without it a
// key is generated at start-up, which works but means sessions from before a restart can no longer
// be checked against the current public key, so production should set it.
const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

function loadKeyPair() {
  const configured = String(process.env.AUDIT_SIGNING_KEY || '').replace(/\\n/g, '\n').trim();
  if (configured) {
    const privateKey = crypto.createPrivateKey(configured);
    return { privateKey, publicKey: crypto.createPublicKey(privateKey), ephemeral: false };
  }
  if (process.env.NODE_ENV === 'production') {
    console.warn('[AUDIT] AUDIT_SIGNING_KEY is not set; using a temporary signing key until the next restart.');
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, publicKey, ephemeral: true };
}

const keys = loadKeyPair();
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const keyId = crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);

function canonicalLink(link) {
  return JSON.stringify({
    seq: link.seq,
    prev: link.prev,
    eventType: link.eventType,
    dataHash: link.dataHash,
    createdAt: link.createdAt,
  });
}

function hashLink(link) {
  return crypto.createHash('sha256').update(canonicalLink(link)).digest('hex');
}

/** Links and signs an anchor onto the end of the room's chain (mutates anchor.chain). */
function appendToChain(anchors, anchor) {
  const last = [...anchors].reverse().find(item => item && item.chain);
  const link = {
    seq: last ? last.chain.seq + 1 : 0,
    prev: last ? last.chain.hash : GENESIS,
    eventType: anchor.eventType,
    dataHash: anchor.dataHash,
    createdAt: anchor.createdAt,
  };
  const hash = hashLink(link);
  const sig = crypto.sign(null, Buffer.from(hash, 'hex'), keys.privateKey).toString('base64');
  anchor.chain = { seq: link.seq, prev: link.prev, hash, sig, keyId };
  return anchor.chain;
}

/**
 * Checks a room's anchors. Returns { status: 'intact' | 'broken' | 'unsigned', length, brokenAt?,
 * reason?, keyId, signedBy? }. Pass a PEM public key to verify against a specific key.
 */
function verifyChain(anchors, publicKey = keys.publicKey) {
  const key = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
  const chained = (anchors || []).filter(item => item && item.chain);
  if (chained.length === 0) return { status: 'unsigned', length: 0, keyId };

  let prev = GENESIS;
  for (let i = 0; i < chained.length; i++) {
    const anchor = chained[i];
    const fail = reason => ({ status: 'broken', length: chained.length, brokenAt: i, eventType: anchor.eventType, reason, keyId });
    if (anchor.chain.seq !== i) return fail('sequence gap: an anchor was removed or reordered');
    if (anchor.chain.prev !== prev) return fail('link does not point at the previous anchor');
    const expected = hashLink({ seq: i, prev, eventType: anchor.eventType, dataHash: anchor.dataHash, createdAt: anchor.createdAt });
    if (expected !== anchor.chain.hash) return fail('anchor contents changed after it was recorded');
    let signatureOk = false;
    try {
      signatureOk = crypto.verify(null, Buffer.from(anchor.chain.hash, 'hex'), key, Buffer.from(anchor.chain.sig, 'base64'));
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return fail(anchor.chain.keyId && anchor.chain.keyId !== keyId
      ? 'signed with a different server key (key rotated or server restarted without AUDIT_SIGNING_KEY)'
      : 'signature does not match');
    prev = anchor.chain.hash;
  }
  // Anchors recorded before chaining was introduced are reported, not treated as tampering
  const unsigned = (anchors || []).length - chained.length;
  return { status: 'intact', length: chained.length, unsignedLegacy: unsigned, keyId, head: prev };
}

module.exports = { appendToChain, verifyChain, publicKeyPem, keyId, ephemeralKey: keys.ephemeral, hashLink, GENESIS };
