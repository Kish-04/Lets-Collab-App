/**
 * Shamir secret sharing over GF(2^8) (AES polynomial 0x11b), applied byte-wise.
 * Any `threshold` shares reconstruct the secret; fewer reveal nothing about it.
 * Must stay byte-for-byte compatible with server/shamir.js.
 */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
    let x = 1
    for (let i = 0; i < 255; i++) {
        EXP[i] = x
        LOG[x] = i
        // multiply by generator 3 in GF(2^8)
        x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0)
        x &= 0xff
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])
const div = (a: number, b: number) => (a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]])

export interface Share {
    x: number
    y: Uint8Array
}

/** Splits `secret` into `count` shares (x = 1..count), any `threshold` of which recover it. */
export function splitSecret(secret: Uint8Array, count: number, threshold: number): Share[] {
    if (threshold < 1 || threshold > count || count > 255) throw new Error('Invalid Shamir parameters')
    const shares = Array.from({ length: count }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }))
    const coefficients = new Uint8Array(threshold - 1)
    for (let byte = 0; byte < secret.length; byte++) {
        crypto.getRandomValues(coefficients)
        for (const share of shares) {
            // Horner evaluation of f(x) = secret + c1*x + c2*x^2 + ... (addition is XOR in GF(2^8))
            let y = 0
            for (let j = coefficients.length - 1; j >= 0; j--) y = mul(y, share.x) ^ coefficients[j]
            share.y[byte] = mul(y, share.x) ^ secret[byte]
        }
    }
    return shares
}

/** Lagrange interpolation at x = 0. */
export function combineShares(shares: Share[]): Uint8Array {
    const length = shares[0].y.length
    const secret = new Uint8Array(length)
    for (let i = 0; i < shares.length; i++) {
        let basis = 1
        for (let j = 0; j < shares.length; j++) {
            if (i === j) continue
            basis = mul(basis, div(shares[j].x, shares[j].x ^ shares[i].x))
        }
        for (let byte = 0; byte < length; byte++) secret[byte] ^= mul(shares[i].y[byte], basis)
    }
    return secret
}
