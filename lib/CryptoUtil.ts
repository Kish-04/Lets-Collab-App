export class CryptoUtil {
    private static keyCache = new Map<string, CryptoKey>();

    private static async getSessionKey(secret: string): Promise<CryptoKey> {
        if (this.keyCache.has(secret)) {
            return this.keyCache.get(secret)!;
        }

        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            'raw',
            enc.encode(secret),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        const salt = enc.encode('letscollab-e2ee-salt'); // Static salt for same room

        const key = await window.crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );

        this.keyCache.set(secret, key);
        return key;
    }

    static async encrypt(text: string, secret: string): Promise<string> {
        try {
            const key = await this.getSessionKey(secret);
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder();
            
            const encryptedContent = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                enc.encode(text)
            );

            const encryptedBytes = new Uint8Array(encryptedContent);
            const combined = new Uint8Array(iv.length + encryptedBytes.length);
            combined.set(iv);
            combined.set(encryptedBytes, iv.length);

            // Convert to base64
            let binary = '';
            for (let i = 0; i < combined.byteLength; i++) {
                binary += String.fromCharCode(combined[i]);
            }
            return btoa(binary);
        } catch (e) {
            console.error('Encryption failed', e);
            return text; // Fallback
        }
    }

    static async decrypt(base64: string, secret: string): Promise<string> {
        try {
            const key = await this.getSessionKey(secret);
            const binary = atob(base64);
            const combined = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                combined[i] = binary.charCodeAt(i);
            }

            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decryptedContent = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                data
            );

            const dec = new TextDecoder();
            return dec.decode(decryptedContent);
        } catch (e) {
            console.error('Decryption failed', e);
            return base64; // Fallback or return raw string if not encrypted
        }
    }
}
