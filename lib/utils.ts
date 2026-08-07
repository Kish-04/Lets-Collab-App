import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

declare global {
  interface Window {
    electronConfig?: {
      backendUrl?: string | null
    }
    __LETSCOLLAB_BACKEND_URL__?: string
  }
}

function normalizeUrl(value?: string | null) {
  const trimmed = String(value || '').trim()
  return trimmed ? trimmed.replace(/\/$/, '') : ''
}

function getRuntimeBackendUrl() {
  if (typeof window === 'undefined') return ''
  let storedBackendUrl = ''
  let qsBackendUrl = ''
  try {
    storedBackendUrl = window.localStorage.getItem('ircp_backend_url') || ''
    const urlParams = new URLSearchParams(window.location.search)
    qsBackendUrl = urlParams.get('backendUrl') || ''
  } catch {
    storedBackendUrl = ''
  }
  return normalizeUrl(
    window.electronConfig?.backendUrl ||
    qsBackendUrl ||
    window.__LETSCOLLAB_BACKEND_URL__ ||
    storedBackendUrl
  )
}

function isLocalOrPrivateHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.')
  )
}

export function getBackendUrl() {
  const runtimeConfigured = getRuntimeBackendUrl()
  if (runtimeConfigured) return runtimeConfigured

  const configured = normalizeUrl(process.env.NEXT_PUBLIC_BACKEND_URL)
  if (configured) return configured

  const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || '8081'
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (isLocalOrPrivateHost(hostname)) {
      return `http://${hostname}:${backendPort}`
    }
    if (window.location.protocol === 'file:') {
      return `http://localhost:${backendPort}`
    }
    return window.location.origin
  }
  return normalizeUrl(process.env.BACKEND_URL) || `http://localhost:${backendPort}`;
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

export function getAuthHeaders(): HeadersInit {
  const token = getStoredAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
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

export function loadExternalScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve()
      return
    }
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.body.appendChild(script)
  })
}
