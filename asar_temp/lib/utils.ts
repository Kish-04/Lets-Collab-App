import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBackendUrl() {
  const configured = process.env.NEXT_PUBLIC_BACKEND_URL
  if (configured) return configured.replace(/\/$/, '')

  const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || '3001'
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.')
    ) {
      return `http://${hostname}:${backendPort}`
    }
    return window.location.origin
  }
  return process.env.BACKEND_URL || `http://localhost:${backendPort}`;
}

export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const storedUser = window.localStorage.getItem('ircp_user')
    if (!storedUser) return null
    const parsed = JSON.parse(storedUser)
    return typeof parsed?.token === 'string' && parsed.token.length > 0 ? parsed.token : null
  } catch {
    return null
  }
}

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  const staticTurnUrl = process.env.NEXT_PUBLIC_TURN_URL
  if (staticTurnUrl) {
    return [
      {
        urls: staticTurnUrl,
        username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
        credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
      },
      { urls: 'stun:stun.l.google.com:19302' },
    ]
  }

  try {
    const backendUrl = getBackendUrl();
    const res = await fetch(`${backendUrl}/api/turn/credentials`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e: any) {
    console.warn('[WebRTC] Falling back to public STUN servers:', e.message);
  }

  // Fallback
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
}
