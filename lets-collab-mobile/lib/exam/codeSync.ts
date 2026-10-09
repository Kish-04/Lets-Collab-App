import * as Y from 'yjs';
import { DataChannelLike, listenChannel } from '../peerEvents';
import { base64ToBytes, bytesToBase64 } from './base64';

/**
 * Streams the candidate's exam code to the host's live view, using the same protocol as the
 * web app's lib/CrdtSync.ts (`bindSharedDoc('exam-code', doc)` in ExamControllerOverlay):
 *
 *   channel  : WebRTC data channel labelled `ircp-crdt` (created by the host)
 *   message  : JSON `{ doc, kind: 'update' | 'sync-request' | 'sync-reply', data: base64 }`
 *   doc      : 'exam-code'; each question's code is `doc.getText('monaco:' + questionId)`
 *   on open  : send sync-request with our state vector
 *   on sync-request : reply with `Y.encodeStateAsUpdate(doc, theirStateVector)`
 *   on update / sync-reply : `Y.applyUpdate`
 *   every local doc update : send as `update`
 */
export const CRDT_CHANNEL = 'ircp-crdt';
export const EXAM_CODE_DOC = 'exam-code';

type CrdtMessage = { doc: string; kind: 'update' | 'sync-request' | 'sync-reply'; data: string };

const REMOTE_ORIGIN = 'peer:host';

export class ExamCodeSync {
  readonly doc = new Y.Doc();
  private channel: DataChannelLike | null = null;
  private unsubscribers: (() => void)[] = [];
  private remoteListeners = new Set<(questionId: string, text: string) => void>();

  constructor() {
    this.doc.on('update', this.onDocUpdate);
    // Surface remote changes (e.g. the host's sync-reply after we reconnect) to the editor.
    this.doc.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin !== REMOTE_ORIGIN) return;
      tr.changed.forEach((_events, type) => {
        // A root type first created by a remote update is a plain AbstractType until getText() is
        // called, so look it up by identity and read it through textFor().
        const key = this.keyOf(type);
        if (!key) return;
        const text = this.textFor(key).toString();
        this.remoteListeners.forEach(listener => listener(key, text));
      });
    });
  }

  /** Attach the host-created `ircp-crdt` channel (from `ondatachannel`). Other labels are ignored. */
  attach(channel: DataChannelLike) {
    if (channel.label !== CRDT_CHANNEL) return false;
    this.detachChannel();
    this.channel = channel;
    this.unsubscribers.push(
      listenChannel(channel, 'open', () => this.requestSync()),
      listenChannel(channel, 'message', event => this.onMessage(event.data)),
      listenChannel(channel, 'close', () => {
        if (this.channel === channel) this.channel = null;
      }),
    );
    if (channel.readyState === 'open') this.requestSync();
    return true;
  }

  onRemoteChange(listener: (questionId: string, text: string) => void) {
    this.remoteListeners.add(listener);
    return () => { this.remoteListeners.delete(listener); };
  }

  textFor(questionId: string) {
    return this.doc.getText(`monaco:${questionId}`);
  }

  /** Seed an empty Y.Text with the starter code (same as the web's handleEditorMount). */
  seed(questionId: string, initial: string) {
    const text = this.textFor(questionId);
    if (text.length === 0 && initial) text.insert(0, initial);
    return text.toString();
  }

  /** Apply a TextInput change to the Y.Text as one minimal replace (common prefix/suffix). */
  applyLocalText(questionId: string, next: string) {
    const text = this.textFor(questionId);
    const prev = text.toString();
    if (prev === next) return;

    let start = 0;
    const maxStart = Math.min(prev.length, next.length);
    while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
      endPrev--;
      endNext--;
    }
    // Never split a UTF-16 surrogate pair.
    if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--;
    if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) { endPrev++; endNext++; }

    this.doc.transact(() => {
      if (endPrev > start) text.delete(start, endPrev - start);
      if (endNext > start) text.insert(start, next.slice(start, endNext));
    });
  }

  destroy() {
    this.detachChannel();
    this.remoteListeners.clear();
    this.doc.off('update', this.onDocUpdate);
    this.doc.destroy();
  }

  // ------------------------------------------------------------------ internals

  private detachChannel() {
    this.unsubscribers.forEach(off => off());
    this.unsubscribers = [];
    this.channel = null;
  }

  private keyOf(type: unknown) {
    for (const [name, value] of this.doc.share) {
      if (value === type && name.startsWith('monaco:')) return name.slice('monaco:'.length);
    }
    return null;
  }

  private send(message: CrdtMessage) {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') return;
    try {
      channel.send(JSON.stringify(message));
    } catch (err) {
      console.warn('[ExamCodeSync] send failed', err);
    }
  }

  private requestSync() {
    this.send({ doc: EXAM_CODE_DOC, kind: 'sync-request', data: bytesToBase64(Y.encodeStateVector(this.doc)) });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Updates that came from the host are not echoed back (the host is the only peer).
    if (origin === REMOTE_ORIGIN) return;
    this.send({ doc: EXAM_CODE_DOC, kind: 'update', data: bytesToBase64(update) });
  };

  private onMessage(raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return;
    let message: CrdtMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || message.doc !== EXAM_CODE_DOC || typeof message.data !== 'string') return;
    try {
      if (message.kind === 'sync-request') {
        const update = Y.encodeStateAsUpdate(this.doc, base64ToBytes(message.data));
        this.send({ doc: EXAM_CODE_DOC, kind: 'sync-reply', data: bytesToBase64(update) });
      } else if (message.kind === 'update' || message.kind === 'sync-reply') {
        Y.applyUpdate(this.doc, base64ToBytes(message.data), REMOTE_ORIGIN);
      }
    } catch (err) {
      console.warn(`[ExamCodeSync] Failed to apply ${message.kind}`, err);
    }
  }
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}
