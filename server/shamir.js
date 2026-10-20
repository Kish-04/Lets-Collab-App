// Shamir secret sharing over GF(2^8) (AES polynomial 0x11b), byte-wise.
// Must stay compatible with lib/shamir.ts (clients split, the server combines).
const crypto = require('crypto');

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => (a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]);

function splitSecret(secret, count, threshold) {
  if (threshold < 1 || threshold > count || count > 255) throw new Error('Invalid Shamir parameters');
  const shares = Array.from({ length: count }, (_, i) => ({ x: i + 1, y: Buffer.alloc(secret.length) }));
  for (let byte = 0; byte < secret.length; byte += 1) {
    const coefficients = crypto.randomBytes(threshold - 1);
    for (const share of shares) {
      let y = 0;
      for (let j = coefficients.length - 1; j >= 0; j -= 1) y = mul(y, share.x) ^ coefficients[j];
      share.y[byte] = mul(y, share.x) ^ secret[byte];
    }
  }
  return shares;
}

/** Lagrange interpolation at x = 0; `shares` are { x, y: Buffer|Uint8Array } with distinct x. */
function combineShares(shares) {
  const length = shares[0].y.length;
  const secret = Buffer.alloc(length);
  for (let i = 0; i < shares.length; i += 1) {
    let basis = 1;
    for (let j = 0; j < shares.length; j += 1) {
      if (i !== j) basis = mul(basis, div(shares[j].x, shares[j].x ^ shares[i].x));
    }
    for (let byte = 0; byte < length; byte += 1) secret[byte] ^= mul(shares[i].y[byte], basis);
  }
  return secret;
}

module.exports = { splitSecret, combineShares };
