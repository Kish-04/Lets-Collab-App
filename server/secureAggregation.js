// Server side of secure aggregation with dropout recovery; see lib/secureAggregation.ts for the protocol.
// The server adds masked vectors, then removes survivors' self masks and dropped participants'
// leftover pairwise masks using secrets reconstructed from survivors' Shamir shares.
const crypto = require('crypto');
const { combineShares } = require('./shamir');

const FIXED_POINT_SCALE = 2 ** 16;
const MASK_INFO = Buffer.from('drcsfa-secagg-mask-v1');
const SELF_INFO = Buffer.from('drcsfa-secagg-self-v1');

/** Decodes a base64 masked submission into a Uint32Array of the expected length, or null. */
function decodeSubmission(base64, expectedLength) {
  if (typeof base64 !== 'string' || base64.length > expectedLength * 8 + 16) return null;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== expectedLength * 4) return null;
  return new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

// Same PRG as the client: HKDF-SHA256 -> AES-128-CTR keystream (zero counter)
function keystream(ikm, salt, info, length) {
  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 16));
  const cipher = crypto.createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
  const out = Buffer.concat([cipher.update(Buffer.alloc(length * 4)), cipher.final()]);
  return new Uint32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length));
}

/** ECDH x-coordinate from a raw P-256 private scalar and a raw uncompressed public key (base64). */
function ecdhSecret(privateScalar, publicKeyBase64) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(privateScalar);
  return ecdh.computeSecret(Buffer.from(publicKeyBase64, 'base64'));
}

function addInto(target, source, sign) {
  for (let i = 0; i < target.length; i += 1) {
    target[i] = sign > 0 ? (target[i] + source[i]) >>> 0 : (target[i] - source[i]) >>> 0;
  }
}

/**
 * Recovers sum(x_u) over survivors.
 * @param masked     Map survivorId -> Uint32Array masked vector
 * @param publicKeys Map participantId -> base64 public key (everyone who received shares)
 * @param revealed   Map ownerId -> { kind: 's'|'b', shares: [{ x, y: base64 }] }
 * @param threshold  shares needed per secret
 */
function recoverSum({ masked, dropped, publicKeys, revealed, threshold, roomId, round }) {
  const survivors = Array.from(masked.keys());
  const length = masked.get(survivors[0]).length;
  const salt = Buffer.from(`${roomId}:${round}`);
  const sum = new Uint32Array(length);
  masked.forEach(vector => addInto(sum, vector, +1));

  const reconstruct = (ownerId, kind) => {
    const entry = revealed.get(ownerId);
    if (!entry || entry.kind !== kind || entry.shares.length < threshold) {
      throw new Error(`not enough ${kind} shares to recover ${ownerId}`);
    }
    return combineShares(entry.shares.slice(0, threshold).map(s => ({ x: s.x, y: Buffer.from(s.y, 'base64') })));
  };

  // Remove every survivor's self mask
  survivors.forEach(id => addInto(sum, keystream(reconstruct(id, 'b'), salt, SELF_INFO, length), -1));

  // Survivor v added +mask(u,v) if v < u, else -mask(u,v), for each dropped u: undo it
  dropped.forEach((droppedId) => {
    const scalar = reconstruct(droppedId, 's');
    survivors.forEach((survivorId) => {
      const mask = keystream(ecdhSecret(scalar, publicKeys.get(survivorId)), salt, MASK_INFO, length);
      addInto(sum, mask, survivorId < droppedId ? -1 : +1);
    });
  });

  return Array.from(sum, value => (value | 0) / FIXED_POINT_SCALE);
}

/**
 * Turns the revealed sum [sum(delta_k * n_k)..., sum(n_k)] into new global weights:
 * base + weighted average delta. Returns null when no samples were contributed.
 */
function applyAggregate(baseWeights, revealedSum) {
  const totalSamples = revealedSum[revealedSum.length - 1];
  if (!(totalSamples > 0.5) || revealedSum.length - 1 !== baseWeights.length) return null;
  return {
    weights: baseWeights.map((weight, index) => weight + revealedSum[index] / totalSamples),
    totalSamples: Math.round(totalSamples),
  };
}

module.exports = { FIXED_POINT_SCALE, decodeSubmission, recoverSum, applyAggregate };
