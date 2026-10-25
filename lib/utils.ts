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
  // No query-string override: a link like ?backendUrl=https://evil would send the user's token and
  // all session signaling to whoever wrote the link.
  let storedBackendUrl = ''
  try {
    storedBackendUrl = window.localStorage.getItem('ircp_backend_url') || ''
  } catch {
    storedBackendUrl = ''
  }
  return normalizeUrl(
    window.electronConfig?.backendUrl ||
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
    // If we are on Vercel and NEXT_PUBLIC_BACKEND_URL is missing, fallback to the known Render URL
    // instead of the Vercel origin (which would cause 404s).
    if (window.location.hostname.includes('vercel.app')) {
      return 'https://let-s-collab-tjwc.onrender.com'
    }
    const hostname = window.location.hostname
    if (isLocalOrPrivateHost(hostname)) {
      return `${window.location.protocol}//${hostname}:${backendPort}`
    }
    if (window.location.protocol === 'file:' || window.location.protocol === 'app:') {
      return window.electronConfig?.backendUrl || `http://localhost:${backendPort}`
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

// Explorer link for an audit transaction; set NEXT_PUBLIC_CHAIN_EXPLORER_TX_URL when the ledger moves
// off Sepolia (e.g. https://polygonscan.com/tx/). A base URL returned by the backend takes precedence.
export function explorerTxUrl(txHash: string, baseUrl?: string | null) {
  const base = baseUrl || process.env.NEXT_PUBLIC_CHAIN_EXPLORER_TX_URL || 'https://sepolia.etherscan.io/tx/'
  return `${base}${txHash}`
}

// Prefers short-lived credentials minted by the backend; credentials baked into the client
// bundle (NEXT_PUBLIC_TURN_*) are only a fallback because anyone can read them.
export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const backendUrl = getBackendUrl();
    const res = await fetch(`${backendUrl}/api/turn/credentials`, { credentials: 'include', headers: getAuthHeaders() });
    if (res.ok) {
      const servers = await res.json();
      if (Array.isArray(servers) && servers.length) return servers;
    }
  } catch (e: any) {
    console.warn('[WebRTC] Could not fetch TURN credentials from backend:', e.message);
  }

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
