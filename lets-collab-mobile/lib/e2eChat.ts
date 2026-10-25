/**
 * End-to-end encrypted room chat, protocol "e2e1" (mobile member side).
 *
 * Byte-compatible port of the web app's lib/E2EChat.ts (WebCrypto) using the audited @noble libraries,
 * because React Native has no WebCrypto:
 *   - per-session ECDH P-256 key pair; public key = raw uncompressed 65 bytes (0x04|X|Y), base64
 *   - shared secret = ECDH X coordinate (32 bytes, = WebCrypto deriveBits(256))
 *   - wrapping key = HKDF-SHA256(shared, salt = UTF-8(roomId), info = "drcsfa-chat-wrap-v1", 32) -> AES-256-GCM
 *   - the host sends `{ hostPublicKey, keys: [{ epoch, iv, ct }] }`; each ct is the wrapped 32-byte group key
 *   - message = "e2e1:<epoch>:<base64(iv[12] | ciphertext+tag)>", AES-256-GCM with that epoch's group key
 * The phone is never the host, so it only unwraps keyrings; it never creates or distributes them.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';

export const E2E_PREFIX = 'e2e1';
const WRAP_INFO = utf8ToBytes('drcsfa-chat-wrap-v1');
const IV_LENGTH = 12;

export interface WrappedKeyring {
  hostPublicKey: string;
  keys: { epoch: number; iv: string; ct: string }[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int16Array(256).fill(-1);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

/** Standard base64 with padding (same output as the web's btoa). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Strict standard base64 decode; throws on malformed input (like atob). */
export function fromBase64(value: string): Uint8Array {
  const clean = value.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('Invalid base64');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)];
    if (v < 0) throw new Error('Invalid base64');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[p++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}

export const isE2EMessage = (text: unknown): text is string =>
  typeof text === 'string' && text.startsWith(`${E2E_PREFIX}:`);

export class E2EChatSession {
  private readonly privateKey: Uint8Array;
  readonly publicKey: string;
  private keyring = new Map<number, Uint8Array>();
  private hostPublicKey = '';

  constructor(readonly roomId: string) {
    // randomSecretKey reduces a 48-byte seed into the field; the seed comes from the OS CSPRNG.
    this.privateKey = p256.utils.randomSecretKey(getRandomBytes(48));
    this.publicKey = toBase64(p256.getPublicKey(this.privateKey, false));
  }

  hasKey() {
    return this.keyring.size > 0;
  }

  private currentEpoch() {
    return Math.max(...this.keyring.keys());
  }

  private wrappingKey(peerPublicKey: string) {
    // getSharedSecret(compressed) = 0x02/0x03 | X; WebCrypto deriveBits(256) is X alone.
    const shared = p256.getSharedSecret(this.privateKey, fromBase64(peerPublicKey), true).slice(1);
    return hkdf(sha256, shared, utf8ToBytes(this.roomId), WRAP_INFO, 32);
  }

  /** Unwraps a keyring sent by the host. Returns true if new epochs were added. Throws on tampering. */
  receiveKeyring(payload: WrappedKeyring) {
    if (!payload || typeof payload.hostPublicKey !== 'string' || !Array.isArray(payload.keys)) {
      throw new Error('Malformed keyring');
    }
    const key = this.wrappingKey(payload.hostPublicKey);
    const unwrapped: [number, Uint8Array][] = [];
    for (const entry of payload.keys) {
      const epoch = Number(entry.epoch);
      if (!Number.isFinite(epoch) || this.keyring.has(epoch)) continue;
      const raw = gcm(key, fromBase64(entry.iv)).decrypt(fromBase64(entry.ct));
      if (raw.length !== 32) throw new Error('Unexpected group key length');
      unwrapped.push([epoch, raw]);
    }
    unwrapped.forEach(([epoch, raw]) => this.keyring.set(epoch, raw));
    this.hostPublicKey = payload.hostPublicKey;
    return unwrapped.length > 0;
  }

  encrypt(text: string) {
    if (!this.hasKey()) throw new Error('No chat key yet');
    const epoch = this.currentEpoch();
    const iv = getRandomBytes(IV_LENGTH);
    const ct = gcm(this.keyring.get(epoch)!, iv).encrypt(utf8ToBytes(text));
    const combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv);
    combined.set(ct, iv.length);
    return `${E2E_PREFIX}:${epoch}:${toBase64(combined)}`;
  }

  /** Plaintext, or null when the epoch is unknown or the ciphertext does not authenticate. */
  decrypt(message: string): string | null {
    const [prefix, epochText, body] = message.split(':');
    if (prefix !== E2E_PREFIX || !body) return null;
    const key = this.keyring.get(Number(epochText));
    if (!key) return null;
    try {
      const combined = fromBase64(body);
      if (combined.length < IV_LENGTH + 16) return null;
      return bytesToUtf8(gcm(key, combined.slice(0, IV_LENGTH)).decrypt(combined.slice(IV_LENGTH)));
    } catch {
      return null;
    }
  }

  /** SHA-256 of the raw host public key, first 8 bytes, uppercase hex in groups of 4 ("3A9F 12C4 ..."). */
  hostFingerprint() {
    if (!this.hostPublicKey) return '';
    const digest = sha256(fromBase64(this.hostPublicKey)).slice(0, 8);
    const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.match(/.{4}/g)!.join(' ');
  }
}
