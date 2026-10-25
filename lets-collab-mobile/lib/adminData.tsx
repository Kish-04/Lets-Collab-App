// Shared data for the admin tabs, the mobile counterpart of the web's components/admin/AdminData.tsx.
// The tab layout mounts it once: every tab uses one Socket.IO connection and one cached copy of
// /api/admin/reports instead of each screen opening its own connection and refetching. It re-asks
// for live data after every reconnect, reports connection problems instead of showing empty lists,
// and signs out on an expired login. Screen observation and the exam wall open their own short-lived
// connection (the server ends an observation or media viewer only when its socket closes).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import io, { type Socket } from 'socket.io-client';
import { BACKEND_URL, getAuthHeaders, getStoredAuthToken, removeAuthToken } from './api';

export type AdminReports = {
  success: boolean;
  userActivity?: any[];
  alerts?: any[];
  sessionHistory?: any[];
  activeSessions?: number;
  generatedAt?: string;
  mock?: boolean;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'error' | 'signed-out';

type AdminData = {
  socket: Socket | null;
  status: ConnectionStatus;
  statusDetail: string;
  sessions: any[] | null;
  reports: AdminReports | null;
  reportsError: string;
  reportsAt: number;
  refreshReports: () => Promise<void>;
};

const AdminDataContext = createContext<AdminData | null>(null);

const REPORTS_FRESH_MS = 15000;
const REPORTS_REFRESH_MS = 60000;

/** Clears the stored login and returns to the sign-in screen. */
export async function signOutAdmin() {
  await removeAuthToken();
  router.replace('/login');
}

/** An authorised request to the backend; throws the server's message on failure, signs out on 401/403. */
export async function adminFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = { ...(await getAuthHeaders()), ...(init.headers as Record<string, string> | undefined) };
  const res = await fetch(`${BACKEND_URL}${path}`, { ...init, headers });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (res.status === 401) {
    await signOutAdmin();
    throw new Error('Your login has expired. Please sign in again.');
  }
  if (!res.ok || (data && data.success === false)) {
    throw new Error(data?.message || data?.error || `Server returned ${res.status}`);
  }
  return data as T;
}

/** Opens an extra authenticated connection (for observation or the exam wall); the caller closes it. */
export async function openAdminConnection(): Promise<Socket | null> {
  const token = await getStoredAuthToken();
  if (!token) return null;
  // Default transports: polling first (no Origin header), then upgrade to WebSocket
  return io(BACKEND_URL, { auth: { token }, timeout: 15000 });
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState('');
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [reports, setReports] = useState<AdminReports | null>(null);
  const [reportsError, setReportsError] = useState('');
  const [reportsAt, setReportsAt] = useState(0);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let connection: Socket | null = null;
    (async () => {
      const token = await getStoredAuthToken();
      if (cancelled) return;
      if (!token) {
        setStatus('signed-out');
        return;
      }
      connection = io(BACKEND_URL, { auth: { token }, timeout: 15000 });
      connection.on('connect', () => {
        setStatus('connected');
        setStatusDetail('');
        // Live data is only sent to admin connections; ask again after every (re)connect
        connection?.emit('identify-user');
        connection?.emit('get-sessions');
      });
      connection.on('disconnect', () => setStatus('connecting'));
      connection.on('connect_error', (err: Error) => {
        setStatus('error');
        setStatusDetail(err?.message || 'Could not reach the server');
      });
      connection.on('sessions-update', (list: any[]) => setSessions(Array.isArray(list) ? list : []));
      // The server answers non-admins with a room count only
      connection.on('sessions-count', () => {
        setSessions(prev => prev ?? []);
        setStatusDetail('This account is not an administrator, so live sessions are not shown.');
      });
      setSocket(connection);
    })();
    return () => {
      cancelled = true;
      connection?.disconnect();
      setSocket(null);
    };
  }, []);

  const loadReports = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const data = await adminFetch<AdminReports>('/api/admin/reports');
        setReports(data);
        setReportsError('');
        setReportsAt(Date.now());
      } catch (err: any) {
        setReportsError(err?.message || String(err));
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  // First load, refresh every minute while the app is in front, and on returning to the app
  useEffect(() => {
    void loadReports();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void loadReports();
    }, REPORTS_REFRESH_MS);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void loadReports();
        socket?.emit('get-sessions');
      }
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [loadReports, socket]);

  // New alerts change the report: refresh a few seconds after a burst of alerts
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAlert = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadReports(), 3000);
    };
    socket.on('system-alert', onAlert);
    return () => { socket.off('system-alert', onAlert); if (timer) clearTimeout(timer); };
  }, [socket, loadReports]);

  return (
    <AdminDataContext.Provider value={{ socket, status, statusDetail, sessions, reports, reportsError, reportsAt, refreshReports: loadReports }}>
      {children}
    </AdminDataContext.Provider>
  );
}

function useAdminData() {
  const value = useContext(AdminDataContext);
  if (!value) throw new Error('Admin screens must be inside AdminDataProvider (app/(tabs)/_layout.tsx)');
  return value;
}

/** The shared connection and its state. Subscribe with useSocketEvent; never disconnect it from a screen. */
export function useAdminSocket() {
  const { socket, status, statusDetail } = useAdminData();
  return { socket, connected: status === 'connected', status, statusDetail };
}

/** Live sessions as the server last sent them (null until the first update). */
export function useLiveSessions() {
  return useAdminData().sessions;
}

/** The cached admin report; refreshed when a screen opens it after REPORTS_FRESH_MS. */
export function useAdminReports() {
  const { reports, reportsError, reportsAt, refreshReports } = useAdminData();
  useEffect(() => {
    if (!reports || Date.now() - reportsAt > REPORTS_FRESH_MS) void refreshReports();
    // Only on first use: background refreshes are the provider's job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data: reports, error: reportsError, refresh: refreshReports };
}

/** Listens to one event on the shared connection while the calling screen is mounted. */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void) {
  const { socket } = useAdminData();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => { socket.off(event, listener); };
  }, [socket, event]);
}

/** Runs now if connected, and again after every reconnect (to re-request data a screen needs). */
export function useOnAdminConnect(run: (socket: Socket) => void) {
  const { socket, status } = useAdminData();
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (socket && status === 'connected') runRef.current(socket);
  }, [socket, status]);
}

export type ServerHealth = { ok: boolean; dbConnected?: boolean; blockchainActive?: boolean } | null;

/** The server's /health, polled every 30 s while the app is in front (for a status badge). */
export function useServerHealth() {
  const [health, setHealth] = useState<ServerHealth>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const res = await fetch(`${BACKEND_URL}/health`);
        const data = await res.json();
        if (stopped) return;
        setHealth(data);
        setUnreachable(!res.ok || !data?.ok);
      } catch {
        if (!stopped) setUnreachable(true);
      }
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  return { health, unreachable };
}
