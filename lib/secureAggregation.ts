/**
 * Client side of secure aggregation with dropout recovery (Bonawitz et al., CCS 2017).
 *
 * Round stages (server/index.js orchestrates them):
 *  1. advertise  - each participant u sends an ephemeral ECDH P-256 public key s_u.
 *  2. share keys - u picks a random self-mask seed b_u, Shamir-splits its private key s_u and b_u
 *                  (threshold t) and sends one share pair to every peer, encrypted with a key derived
 *                  from ECDH(s_u, s_v), relayed by the server.
 *  3. masked input - u sends x_u + PRG(b_u) + sum_v(+/-PRG(ECDH(s_u, s_v))) mod 2^32. Pairwise masks
 *                  cancel between survivors; the self mask hides x_u even if the server lies about
 *                  who dropped.
 *  4. unmask     - survivors reveal, for each peer, EITHER its b share (peer survived) OR its s share
 *                  (peer dropped) - never both - so the server can remove self masks and the dropped
 *                  peers' leftover pairwise masks. It learns only the sum.
 * Values are fixed-point encoded so the cancellation is exact. Compatible with server/secureAggregation.js.
 */
import { splitSecret, type Share } from './shamir'

export const FIXED_POINT_SCALE = 2 ** 16

const MASK_INFO = new TextEncoder().encode('drcsfa-secagg-mask-v1')
const SELF_INFO = new TextEncoder().encode('drcsfa-secagg-self-v1')
const SHARE_INFO = new TextEncoder().encode('drcsfa-secagg-share-v1')

export interface RoundPeer {
    id: string
    publicKey: string
}

export interface RoundKeys {
    privateKey: CryptoKey
    publicKey: string
    privateScalar: Uint8Array
}

export interface HeldShare {
    x: number
    s: string
    b: string
}

export function toBase64(bytes: Uint8Array) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

export function fromBase64(value: string) {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const fromBase64Url = (value: string) => fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4))

/** Shamir threshold for n participants: a strict majority. */
export const shareThreshold = (count: number) => Math.max(2, Math.floor(count / 2) + 1)

/** Peers sorted by id give every participant the same Shamir x-coordinate (index + 1). */
export const orderPeers = (peers: RoundPeer[]) => [...peers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

export async function createRoundKeys(): Promise<RoundKeys> {
    // Extractable so the private scalar can be Shamir-shared for dropout recovery
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
    return { privateKey: keyPair.privateKey, publicKey: toBase64(raw), privateScalar: fromBase64Url(jwk.d!) }
}

async function sharedSecret(privateKey: CryptoKey, peerPublicKey: string) {
    const peerKey = await crypto.subtle.importKey('raw', fromBase64(peerPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    return crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256)
}

// PRG: AES-CTR keystream under a key derived by HKDF from `ikm`
async function keystream(ikm: BufferSource, salt: Uint8Array, info: Uint8Array, length: number) {
    const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
    const aesKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, hkdfKey, { name: 'AES-CTR', length: 128 }, false, ['encrypt'])
    const stream = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 64 }, aesKey, new Uint8Array(length * 4))
    return new Uint32Array(stream)
}

async function shareKey(privateKey: CryptoKey, peerPublicKey: string, salt: Uint8Array) {
    const hkdfKey = await crypto.subtle.importKey('raw', await sharedSecret(privateKey, peerPublicKey), 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: SHARE_INFO }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

const roundSalt = (roomId: string, round: number) => new TextEncoder().encode(`${roomId}:${round}`)

/** Stage 2: Shamir-split s_u and b_u and encrypt one share pair to each peer (including ourselves). */
export async function prepareShares(options: { keys: RoundKeys; selfSeed: Uint8Array; peers: RoundPeer[]; roomId: string; round: number }) {
    const { keys, selfSeed, roomId, round } = options
    const peers = orderPeers(options.peers)
    const threshold = shareThreshold(peers.length)
    const sShares = splitSecret(keys.privateScalar, peers.length, threshold)
    const bShares = splitSecret(selfSeed, peers.length, threshold)
    const salt = roundSalt(roomId, round)
    const encrypted = []
    for (let i = 0; i < peers.length; i++) {
        const plain = new TextEncoder().encode(JSON.stringify({ x: sShares[i].x, s: toBase64(sShares[i].y), b: toBase64(bShares[i].y) }))
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await shareKey(keys.privateKey, peers[i].publicKey, salt), plain))
        encrypted.push({ to: peers[i].id, ct: `${toBase64(iv)}.${toBase64(ct)}` })
    }
    return { threshold, shares: encrypted }
}

/** Stage 3 (receive): decrypt the share pairs other participants sent us. */
export async function openShares(options: { keys: RoundKeys; received: { from: string; ct: string }[]; peers: RoundPeer[]; roomId: string; round: number }) {
    const { keys, received, peers, roomId, round } = options
    const salt = roundSalt(roomId, round)
    const held = new Map<string, HeldShare>()
    for (const { from, ct } of received) {
        const peer = peers.find(p => p.id === from)
        if (!peer) continue
        const [iv, body] = ct.split('.')
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await shareKey(keys.privateKey, peer.publicKey, salt), fromBase64(body))
        held.set(from, JSON.parse(new TextDecoder().decode(plain)))
    }
    return held
}

/** Stage 3: fixed-point encode and add the self mask plus pairwise masks for the surviving peers. */
export async function maskVector(options: {
    values: ArrayLike<number>
    keys: RoundKeys
    selfSeed: Uint8Array
    selfId: string
    peers: RoundPeer[]
    roomId: string
    round: number
}) {
    const { values, keys, selfSeed, selfId, peers, roomId, round } = options
    const salt = roundSalt(roomId, round)
    const masked = new Uint32Array(values.length)
    for (let i = 0; i < values.length; i++) masked[i] = Math.round(values[i] * FIXED_POINT_SCALE) >>> 0

    const self = await keystream(selfSeed, salt, SELF_INFO, values.length)
    for (let i = 0; i < masked.length; i++) masked[i] = (masked[i] + self[i]) >>> 0

    for (const peer of peers) {
        if (peer.id === selfId) continue
        const mask = await keystream(await sharedSecret(keys.privateKey, peer.publicKey), salt, MASK_INFO, values.length)
        const add = selfId < peer.id
        for (let i = 0; i < masked.length; i++) masked[i] = add ? (masked[i] + mask[i]) >>> 0 : (masked[i] - mask[i]) >>> 0
    }
    return toBase64(new Uint8Array(masked.buffer))
}

/**
 * Stage 4: reveal b shares for survivors and s shares for dropped peers. Refuses if any id is in
 * both lists, because revealing both for one participant would expose that participant's input.
 */
export function revealShares(held: Map<string, HeldShare>, survivors: string[], dropped: string[]) {
    if (survivors.some(id => dropped.includes(id))) throw new Error('A participant cannot be both a survivor and dropped')
    const revealed: { owner: string; kind: 's' | 'b'; x: number; y: string }[] = []
    for (const id of survivors) {
        const share = held.get(id)
        if (share) revealed.push({ owner: id, kind: 'b', x: share.x, y: share.b })
    }
    for (const id of dropped) {
        const share = held.get(id)
        if (share) revealed.push({ owner: id, kind: 's', x: share.x, y: share.s })
    }
    return revealed
}

function gaussian() {
    let u = 0
    while (u === 0) u = Math.random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}

/**
 * Builds the vector a participant contributes: its clipped (and optionally noised) model delta
 * scaled by its sample count, followed by the sample count, so the server can form a weighted
 * average from the revealed sum without learning anyone's individual count.
 * L2 clipping bounds every value, which keeps the fixed-point sum from overflowing.
 *
 * Differential privacy (see lib/dpAccountant.ts): with `noiseMultiplier` sigma > 0 the device adds
 * Gaussian noise of std sigma * clipNorm / sqrt(noiseShares), so the sum of `noiseShares` devices
 * carries sigma * clipNorm in total. `equalWeight` gives every device weight 1 (DP-FedAvg), which
 * bounds one device's influence on the sum by clipNorm; sample-count weighting would not.
 */
export function buildContribution(delta: ArrayLike<number>, sampleCount: number, clipNorm = 1, noiseMultiplier = 0, noiseShares = 1, equalWeight = false) {
    const norm = Math.sqrt(Array.from(delta).reduce((total, value) => total + value * value, 0))
    const scale = norm > clipNorm ? clipNorm / norm : 1
    const count = equalWeight ? 1 : Math.max(0, Math.min(500, Math.round(sampleCount)))
    const noiseStd = noiseMultiplier > 0 ? (noiseMultiplier * clipNorm) / Math.sqrt(Math.max(1, noiseShares)) : 0
    const vector = new Float64Array(delta.length + 1)
    for (let i = 0; i < delta.length; i++) {
        const noise = noiseStd > 0 ? gaussian() * noiseStd : 0
        vector[i] = (delta[i] * scale + noise) * count
    }
    vector[delta.length] = count
    return vector
}

export type { Share }
