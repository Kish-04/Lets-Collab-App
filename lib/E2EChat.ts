/**
 * End-to-end encrypted room chat (protocol "e2e1"). The server only relays public keys and ciphertext.
 *
 * - Every participant creates an ephemeral ECDH P-256 key pair per session and announces the raw
 *   (uncompressed, 65-byte) public key with `e2e-announce`. The server broadcasts the room roster.
 * - The host owns a keyring of AES-256-GCM group keys, one per epoch. It sends the keyring to each
 *   member wrapped with a key derived from ECDH(host, member) -> HKDF-SHA256(salt = roomId,
 *   info = "drcsfa-chat-wrap-v1"), so only that member can unwrap it.
 * - When a member leaves, the host starts a new epoch that the departed member never receives.
 *   New members get every epoch, so they can read the room's history.
 * - Message format: "e2e1:<epoch>:<base64(iv[12] | ciphertext+tag)>".
 * - Participants can compare the host key fingerprint out of band to rule out a key-swapping server.
 *
 * The mobile app implements the same protocol with @noble (see lets-collab-mobile/lib/e2eChat.ts).
 */

export const E2E_PREFIX = 'e2e1'
const WRAP_INFO = new TextEncoder().encode('drcsfa-chat-wrap-v1')

export interface RosterMember {
    id: string
    publicKey: string
}

export interface WrappedKeyring {
    hostPublicKey: string
    keys: { epoch: number; iv: string; ct: string }[]
}

function toBase64(bytes: Uint8Array) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(binary)
}

function fromBase64(value: string) {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export class E2EChatSession {
    private privateKey: CryptoKey | null = null
    publicKey = ''
    private keyring = new Map<number, CryptoKey>()
    private rawKeys = new Map<number, Uint8Array>()
    private hostPublicKey = ''
    // Host bookkeeping: which members already hold which keyring version, and who was present
    private sharedVersion = new Map<string, number>()
    private keyringVersion = 0
    private knownMembers = new Set<string>()

    constructor(readonly roomId: string) {}

    async init() {
        if (this.privateKey) return this.publicKey
        const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
        this.privateKey = pair.privateKey
        this.publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
        return this.publicKey
    }

    /** Host only: forget what a member holds so the next roster pass re-sends the keyring. */
    resetShare(memberId: string) {
        this.sharedVersion.delete(memberId)
    }

    hasKey() {
        return this.keyring.size > 0
    }

    private currentEpoch() {
        return Math.max(...this.keyring.keys())
    }

    private async wrappingKey(peerPublicKey: string, usage: 'encrypt' | 'decrypt') {
        if (!this.privateKey) throw new Error('E2E session not initialised')
        const peer = await crypto.subtle.importKey('raw', fromBase64(peerPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
        const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, this.privateKey, 256)
        const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
        return crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(this.roomId), info: WRAP_INFO },
            hkdf,
            { name: 'AES-GCM', length: 256 },
            false,
            [usage],
        )
    }

    private async addEpoch(epoch: number, raw: Uint8Array) {
        this.rawKeys.set(epoch, raw)
        this.keyring.set(epoch, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
    }

    /** Host only: start a new epoch (initially, and whenever a member leaves). */
    async rotate() {
        const epoch = Math.max(Date.now(), this.keyring.size ? this.currentEpoch() + 1 : 0)
        await this.addEpoch(epoch, crypto.getRandomValues(new Uint8Array(32)))
        this.keyringVersion += 1
        this.hostPublicKey = this.publicKey
    }

    /**
     * Host only: reacts to a roster update. Rotates if someone left, then returns the wrapped
     * keyring for every member that does not hold the latest version yet.
     */
    async hostHandleRoster(selfId: string, members: RosterMember[]) {
        const present = new Set(members.map(m => m.id))
        const someoneLeft = Array.from(this.knownMembers).some(id => !present.has(id))
        this.knownMembers = present
        if (!this.hasKey() || someoneLeft) await this.rotate()

        const shares: { targetId: string; payload: WrappedKeyring }[] = []
        for (const member of members) {
            if (member.id === selfId || this.sharedVersion.get(member.id) === this.keyringVersion) continue
            const key = await this.wrappingKey(member.publicKey, 'encrypt')
            const keys = []
            for (const [epoch, raw] of this.rawKeys) {
                const iv = crypto.getRandomValues(new Uint8Array(12))
                const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw))
                keys.push({ epoch, iv: toBase64(iv), ct: toBase64(ct) })
            }
            this.sharedVersion.set(member.id, this.keyringVersion)
            shares.push({ targetId: member.id, payload: { hostPublicKey: this.publicKey, keys } })
        }
        return shares
    }

    /** Member: unwraps a keyring sent by the host. Returns true if new epochs were added. */
    async receiveKeyring(payload: WrappedKeyring) {
        const key = await this.wrappingKey(payload.hostPublicKey, 'decrypt')
        let added = false
        for (const entry of payload.keys) {
            if (this.keyring.has(entry.epoch)) continue
            const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(entry.iv) }, key, fromBase64(entry.ct)))
            await this.addEpoch(entry.epoch, raw)
            added = true
        }
        this.hostPublicKey = payload.hostPublicKey
        return added
    }

    async encrypt(text: string) {
        if (!this.hasKey()) throw new Error('No chat key yet')
        const epoch = this.currentEpoch()
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.keyring.get(epoch)!, new TextEncoder().encode(text)))
        const combined = new Uint8Array(iv.length + ct.length)
        combined.set(iv)
        combined.set(ct, iv.length)
        return `${E2E_PREFIX}:${epoch}:${toBase64(combined)}`
    }

    /** Returns plaintext, or null when this message was encrypted with an epoch we don't hold. */
    async decrypt(message: string): Promise<string | null> {
        const [prefix, epochText, body] = message.split(':')
        if (prefix !== E2E_PREFIX || !body) return null
        const key = this.keyring.get(Number(epochText))
        if (!key) return null
        try {
            const combined = fromBase64(body)
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12))
            return new TextDecoder().decode(plain)
        } catch {
            return null
        }
    }

    /** Short fingerprint of the host key, for out-of-band comparison between participants. */
    async hostFingerprint() {
        if (!this.hostPublicKey) return ''
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64(this.hostPublicKey)))
        return Array.from(digest.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g)!.join(' ')
    }
}

export const isE2EMessage = (text: string) => typeof text === 'string' && text.startsWith(`${E2E_PREFIX}:`)
