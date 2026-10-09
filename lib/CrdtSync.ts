import * as Y from 'yjs'
import { dataChannelManager } from './DataChannelManager'

/**
 * Yjs sync over the WebRTC `ircp-crdt` data channel.
 *
 * Peers exchange state vectors when a channel opens (sync-request) and answer with the missing
 * updates (sync-reply); after that every local change is streamed as an incremental update.
 * The topology is a star: controllers only connect to the host, so the host relays updates
 * between controllers when a document is meant to be shared by everyone.
 */
export const CRDT_CHANNEL = 'ircp-crdt'

type CrdtMessage = { doc: string; kind: 'update' | 'sync-request' | 'sync-reply'; data: string }
type Handler = (message: CrdtMessage, peerId: string) => void

const handlers = new Map<string, Handler>()

const PEER_ORIGIN = 'peer:'

function toBase64(bytes: Uint8Array) {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(binary)
}

function fromBase64(value: string) {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

function dispatch(message: CrdtMessage, peerId: string) {
    if (!message || typeof message.doc !== 'string' || typeof message.data !== 'string') return
    try {
        handlers.get(message.doc)?.(message, peerId)
    } catch (err) {
        console.warn(`[CrdtSync] Failed to apply ${message.kind} for ${message.doc}`, err)
    }
}

// Re-registered on every bind because the session reset (dataChannelManager.clearAll) drops listeners;
// listeners are a Set, so registering the same function again is a no-op
function ensureListening() {
    dataChannelManager.on(CRDT_CHANNEL, dispatch)
}

function send(message: CrdtMessage, peerId?: string) {
    dataChannelManager.send(CRDT_CHANNEL, message, peerId)
}

interface SharedDocOptions {
    // Forward updates received from one peer to all other peers (host acting as hub)
    relay?: boolean
    // Only sync with this one peer; messages from anyone else are ignored
    peerId?: string
}

/** Keeps `doc` in sync with connected peers. Returns a function that stops syncing. */
export function bindSharedDoc(name: string, doc: Y.Doc, { relay = false, peerId: onlyPeer }: SharedDocOptions = {}) {
    ensureListening()

    const requestSync = (peerId?: string) => {
        if (onlyPeer && peerId && peerId !== onlyPeer) return
        send({ doc: name, kind: 'sync-request', data: toBase64(Y.encodeStateVector(doc)) }, peerId ?? onlyPeer)
    }

    const onUpdate = (update: Uint8Array, origin: unknown) => {
        const message: CrdtMessage = { doc: name, kind: 'update', data: toBase64(update) }
        if (typeof origin === 'string' && origin.startsWith(PEER_ORIGIN)) {
            if (!relay || onlyPeer) return
            const source = origin.slice(PEER_ORIGIN.length)
            dataChannelManager.getOpenPeers(CRDT_CHANNEL)
                .filter(peerId => peerId !== source)
                .forEach(peerId => send(message, peerId))
            return
        }
        send(message, onlyPeer)
    }

    const handler: Handler = (message, peerId) => {
        if (onlyPeer && peerId !== onlyPeer) return
        if (message.kind === 'sync-request') {
            const update = Y.encodeStateAsUpdate(doc, fromBase64(message.data))
            send({ doc: name, kind: 'sync-reply', data: toBase64(update) }, peerId)
        } else {
            Y.applyUpdate(doc, fromBase64(message.data), `${PEER_ORIGIN}${peerId}`)
        }
    }

    doc.on('update', onUpdate)
    handlers.set(name, handler)
    const offOpen = dataChannelManager.onOpen(CRDT_CHANNEL, (peerId) => {
        ensureListening()
        requestSync(peerId)
    })
    requestSync()

    return () => {
        doc.off('update', onUpdate)
        offOpen()
        if (handlers.get(name) === handler) handlers.delete(name)
    }
}

/**
 * Receives one read-only copy of `name` per peer (e.g. each candidate's exam code on the host).
 * Nothing is ever sent back or relayed, so peers never see each other's documents.
 */
export function observePeerDocs(name: string, onDoc: (peerId: string, doc: Y.Doc) => void) {
    ensureListening()
    const docs = new Map<string, Y.Doc>()

    const docFor = (peerId: string) => {
        let doc = docs.get(peerId)
        if (!doc) {
            doc = new Y.Doc()
            docs.set(peerId, doc)
            onDoc(peerId, doc)
        }
        return doc
    }

    const requestSync = (peerId: string) => {
        const known = docs.get(peerId)
        send({ doc: name, kind: 'sync-request', data: toBase64(Y.encodeStateVector(known ?? new Y.Doc())) }, peerId)
    }

    const handler: Handler = (message, peerId) => {
        if (message.kind === 'sync-request') {
            // A peer that reloaded gets its own content back; it never receives another peer's document
            const own = docs.get(peerId)
            const update = own ? Y.encodeStateAsUpdate(own, fromBase64(message.data)) : Y.encodeStateAsUpdate(new Y.Doc())
            send({ doc: name, kind: 'sync-reply', data: toBase64(update) }, peerId)
        } else {
            Y.applyUpdate(docFor(peerId), fromBase64(message.data), `${PEER_ORIGIN}${peerId}`)
        }
    }
    handlers.set(name, handler)

    const offOpen = dataChannelManager.onOpen(CRDT_CHANNEL, (peerId) => {
        ensureListening()
        requestSync(peerId)
    })
    dataChannelManager.getOpenPeers(CRDT_CHANNEL).forEach(requestSync)

    return {
        docs,
        dispose: () => {
            offOpen()
            if (handlers.get(name) === handler) handlers.delete(name)
            docs.forEach(doc => doc.destroy())
            docs.clear()
        },
    }
}
