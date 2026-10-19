import { BACKEND_URL, getAuthHeaders } from './api';

export type SessionMode = 'collaboration' | 'supervised';
export type PermissionLevel = 'view' | 'mouse' | 'keyboard' | 'full';

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

/** Mirrors the server's `chat-message` payload (server/index.js). */
export type ChatMessage = {
  id: string;
  time: string;
  senderId: string;
  senderName: string;
  role: 'host' | 'controller' | 'admin';
  text: string;
};

/** Same `{ screen, camera }` stream id map the web client sends with every offer/answer. */
export type MediaStreamIds = { screen?: string | null; camera?: string | null };

const FALLBACK_ICE_SERVERS: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Room codes are normalized the same way as the web join input
 * (`toUpperCase().replace(/[^A-Z0-9]/g, '')`) and the server's `normalizeRoomCode`.
 */
export function normalizeRoomCode(value: string | undefined | null) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Same endpoint and fallback as `getIceServers()` in the web app's lib/utils.ts. */
export async function fetchIceServers(): Promise<IceServer[]> {
  try {
    // Signed-in users get TURN relay credentials; without a token the server returns STUN only
    const res = await fetch(`${BACKEND_URL}/api/turn/credentials`, { headers: await getAuthHeaders() });
    if (res.ok) {
      const servers = await res.json();
      if (Array.isArray(servers) && servers.length > 0) return servers;
    }
  } catch (e: any) {
    console.warn('[WebRTC] Falling back to public STUN servers:', e?.message);
  }
  return FALLBACK_ICE_SERVERS;
}
