// Pure helpers for remote input on the host (main.js execute-input): where a controller's click lands,
// which application is under it, and the host's per-application approvals during an entire-screen share.
// Kept free of Electron and native imports so it can be unit-tested (tests/remoteAppPolicy.test.mjs).
//
// Coordinates: on Windows everything here is in PHYSICAL virtual-desktop pixels, the space robotjs
// injects into (SendInput with MOUSEEVENTF_VIRTUALDESK) and GetWindowRect reports in (Electron's main
// process is per-monitor DPI aware). On macOS it is global points, on X11 physical pixels.

const MINIMISED_COORD = -10000; // Windows parks minimised windows at about (-32000, -32000)

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function isUsableRect(rect) {
  return Boolean(rect)
    && Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width > 0 && rect.height > 0;
}

function isMinimisedRect(rect) {
  return !isUsableRect(rect) || rect.x <= MINIMISED_COORD || rect.y <= MINIMISED_COORD;
}

function rectContains(rect, x, y) {
  return isUsableRect(rect) && x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

// Normalised (0..1) position in the shared video -> integer pixel inside `rect` (never one past its edge)
function mapNormalizedToRect(nx, ny, rect) {
  if (!isUsableRect(rect)) return null;
  return {
    x: rect.x + Math.min(rect.width - 1, Math.floor(clamp01(nx) * rect.width)),
    y: rect.y + Math.min(rect.height - 1, Math.floor(clamp01(ny) * rect.height)),
  };
}

// The rectangle (in injection space) of the display behind a "screen:<id>:0" share.
// win32: Electron's display bounds are DIPs whose origins are not simply scaled, so the caller passes
// screen.dipToScreenRect. linux (X11): physical = DIP * scaleFactor. darwin: points = DIPs.
function resolveDisplayRect({ displays, displayId, platform, dipToScreenRect }) {
  if (!Array.isArray(displays) || displayId === undefined || displayId === null || displayId === '') return null;
  const display = displays.find(item => item && String(item.id) === String(displayId));
  if (!display || !isUsableRect(display.bounds)) return null;
  const bounds = display.bounds;
  if (platform === 'win32' && typeof dipToScreenRect === 'function') {
    const physical = dipToScreenRect(bounds);
    return isUsableRect(physical) ? { x: physical.x, y: physical.y, width: physical.width, height: physical.height } : null;
  }
  if (platform === 'linux') {
    const sf = Number(display.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
    return { x: Math.round(bounds.x * sf), y: Math.round(bounds.y * sf), width: Math.round(bounds.width * sf), height: Math.round(bounds.height * sf) };
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

// GetWindowRect includes Windows 10/11's invisible resize border (left, right and bottom; on all four
// sides when maximised), but the captured video shows only the visible window. From the captured
// frame's aspect ratio work out that border so a click on the video's left edge lands on the window's
// left edge. Returns { left, top, right, bottom } in pixels (all 0 when nothing convincing is found).
function captureFrameInset(rect, frameWidth, frameHeight, maxBorder = 16) {
  const none = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!isUsableRect(rect) || !(frameWidth > 0) || !(frameHeight > 0)) return none;
  const aspect = frameWidth / frameHeight;
  const W = rect.width;
  const H = rect.height;
  const diff = aspect * H - W;
  const valid = (border) => Number.isFinite(border) && border >= 0.5 && border <= maxBorder;
  // Normal window: visible = (W - 2b) x (H - b)
  if (Math.abs(aspect - 2) > 1e-6) {
    const border = diff / (aspect - 2);
    if (valid(border)) {
      const b = Math.round(border);
      return { left: b, top: 0, right: b, bottom: b };
    }
  }
  // Maximised window: visible = (W - 2b) x (H - 2b)
  if (Math.abs(aspect - 1) > 1e-6) {
    const border = diff / (2 * aspect - 2);
    if (valid(border)) {
      const b = Math.round(border);
      return { left: b, top: b, right: b, bottom: b };
    }
  }
  return none;
}

function insetRect(rect, inset) {
  if (!isUsableRect(rect) || !inset) return rect;
  const next = {
    x: rect.x + (inset.left || 0),
    y: rect.y + (inset.top || 0),
    width: rect.width - (inset.left || 0) - (inset.right || 0),
    height: rect.height - (inset.top || 0) - (inset.bottom || 0),
  };
  return isUsableRect(next) ? next : rect;
}

// Windows that are "visible" and cover the screen but never receive clicks (click-through overlays).
// Skipping them lets the hit test find the window the click really reaches.
const CLICK_THROUGH_EXES = new Set([
  'textinputhost.exe', // Windows touch keyboard / emoji panel host, a cloaked full-screen window
  'nvidia share.exe', 'nvidia overlay.exe',
]);

function exeBaseName(exePath) {
  const value = String(exePath || '');
  return value.split(/[\\/]/).pop() || '';
}

// Windows 10/11 keep many "visible" windows that are cloaked by the compositor and never drawn or
// clicked: the lock screen (LockApp), the closed Start menu and Search, suspended Store apps, taskbar
// thumbnail windows... EnumWindows still reports them, often on top of everything. `visibleIds` is the
// set of windows the screen capturer lists (it skips cloaked windows, but also tool windows such as the
// taskbar and menus), so a window outside it is only believed when it is plainly real:
//   - the foreground window, or another window of the foreground program (its menus and popups),
//     except explorer.exe whose taskbar-preview windows are cloaked;
//   - one of our own windows (identified by process);
//   - a large explorer.exe window (the taskbar, the desktop); its cloaked windows are small previews.
function isShownWindow(id, info, bounds, opts) {
  const { visibleIds, foregroundId, foregroundPid, ownPid } = opts;
  if (!visibleIds) return true; // no capturer list (macOS / Linux): trust the window list
  if (visibleIds.has(id) || visibleIds.has(String(id))) return true;
  if (foregroundId !== undefined && foregroundId !== null && String(id) === String(foregroundId)) return true;
  const pid = Number(info.processId);
  if (ownPid !== undefined && ownPid !== null && pid === Number(ownPid)) return true;
  const isExplorer = exeBaseName(info.path).toLowerCase() === 'explorer.exe';
  if (isExplorer) return Math.max(bounds.width, bounds.height) >= 300;
  return foregroundPid !== undefined && foregroundPid !== null && pid === Number(foregroundPid);
}

// Top-most window that contains (x, y). `ids` are window handles in z-order, top first (EnumWindows
// order on Windows). Lookups are callbacks so the expensive process query only runs for windows that
// actually contain the point.
function findWindowAt(ids, x, y, {
  isVisible, getBounds, describe, skipIds, skipExeNames = CLICK_THROUGH_EXES,
  visibleIds = null, foregroundId = null, foregroundPid = null, ownPid = null,
} = {}) {
  if (!Array.isArray(ids)) return null;
  const opts = { visibleIds, foregroundId, foregroundPid, ownPid };
  for (const id of ids) {
    if (skipIds && (skipIds.has(id) || skipIds.has(String(id)))) continue;
    try {
      if (isVisible && !isVisible(id)) continue;
      const bounds = getBounds ? getBounds(id) : null;
      if (isMinimisedRect(bounds) || !rectContains(bounds, x, y)) continue;
      const info = describe ? (describe(id) || {}) : {};
      if (skipExeNames && skipExeNames.has(exeBaseName(info.path).toLowerCase())) continue;
      if (!isShownWindow(id, info, bounds, opts)) continue;
      return { id, bounds, processId: info.processId, path: info.path || '', title: info.title || '' };
    } catch (e) {
      // A window that closes mid-scan is skipped
    }
  }
  return null;
}

const FRIENDLY_NAMES = {
  'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge', 'firefox.exe': 'Firefox',
  'code.exe': 'Visual Studio Code', 'notepad.exe': 'Notepad', 'cmd.exe': 'Command Prompt',
  'powershell.exe': 'Windows PowerShell', 'pwsh.exe': 'PowerShell', 'windowsterminal.exe': 'Windows Terminal',
  'taskmgr.exe': 'Task Manager', 'mspaint.exe': 'Paint', 'winword.exe': 'Microsoft Word',
  'excel.exe': 'Microsoft Excel', 'powerpnt.exe': 'Microsoft PowerPoint', 'outlook.exe': 'Microsoft Outlook',
  'startmenuexperiencehost.exe': 'Start menu', 'searchhost.exe': 'Windows Search',
  'systemsettings.exe': 'Windows Settings', 'applicationframehost.exe': 'Windows app',
  'regedit.exe': 'Registry Editor', 'mmc.exe': 'Management Console',
};

const UNKNOWN_APP = { key: 'unknown', name: 'Unknown application', kind: 'unknown', path: '' };

// Which application a window belongs to, as the unit the host approves.
//   kind 'own'   - one of Let's Collab's own windows (never controllable remotely)
//   kind 'shell' - the Windows desktop, taskbar and File Explorer (explorer.exe), approved as one
//   kind 'app'   - any other program, keyed by its executable path
function classifyApp(info, { ownPid, platform = process.platform } = {}) {
  if (!info) return { ...UNKNOWN_APP };
  if (ownPid !== undefined && ownPid !== null && Number(info.processId) === Number(ownPid)) {
    return { key: 'own', name: "Let's Collab", kind: 'own', path: info.path || '' };
  }
  const exePath = String(info.path || '').trim();
  if (!exePath) return { ...UNKNOWN_APP };
  const base = exeBaseName(exePath);
  const lowerBase = base.toLowerCase();
  const key = platform === 'win32' || platform === 'darwin' ? exePath.toLowerCase() : exePath;
  if (platform === 'win32' && lowerBase === 'explorer.exe') {
    return { key, name: 'Windows desktop, taskbar & File Explorer', kind: 'shell', path: exePath };
  }
  // Store apps (Settings, Calculator...) all run in ApplicationFrameHost.exe frames: approving one must
  // not approve the others, so they are told apart by their window title
  if (platform === 'win32' && lowerBase === 'applicationframehost.exe') {
    const title = String(info.title || '').trim();
    return { key: `${key}|${title.toLowerCase()}`, name: title || 'Windows app', kind: 'app', path: exePath };
  }
  let name = FRIENDLY_NAMES[lowerBase];
  if (!name) {
    const bundle = exePath.match(/([^/\\]+)\.app(?:[/\\]|$)/i);
    name = bundle ? bundle[1] : base.replace(/\.exe$/i, '');
  }
  return { key, name: name || UNKNOWN_APP.name, kind: 'app', path: exePath };
}

// Per-session approvals for an entire-screen share.
//   check(app)                      -> 'allow' | 'own' | 'pending' | 'denied' | 'request'
//   request(app, meta, held, now)   -> the new request object (one per app at a time)
//   resolve(id, allow, remember)    -> { request, allowed } or null
//   reset()                         -> clears approvals and pending requests (revoke / share ended);
//                                      apps approved with "remember" stay until resetAll()
class AppApprovalPolicy {
  constructor({ enabled = true, denyCooldownMs = 10000 } = {}) {
    this.enabled = Boolean(enabled);
    this.denyCooldownMs = denyCooldownMs;
    this.approved = new Set();
    this.remembered = new Set();
    this.denied = new Map(); // key -> time of the denial
    this.pending = new Map(); // id -> request
    this.nextId = 1;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) return this.clearPending();
    return [];
  }

  isApproved(key) {
    return this.approved.has(key) || this.remembered.has(key);
  }

  pendingFor(key) {
    for (const request of this.pending.values()) if (request.app.key === key) return request;
    return null;
  }

  check(app, now = Date.now()) {
    if (!app || app.kind === 'own') return 'own';
    if (!this.enabled || this.isApproved(app.key)) return 'allow';
    if (this.pendingFor(app.key)) return 'pending';
    const deniedAt = this.denied.get(app.key);
    if (deniedAt !== undefined && now - deniedAt < this.denyCooldownMs) return 'denied';
    return 'request';
  }

  request(app, meta = {}, held = null, now = Date.now()) {
    const existing = this.pendingFor(app.key);
    if (existing) return existing;
    const request = { id: `app-${this.nextId++}`, app, meta, held, createdAt: now };
    this.pending.set(request.id, request);
    return request;
  }

  // While a request is pending, the first mouse release of the held click is remembered so an allowed
  // click is replayed as a whole click (the controller's button is usually up long before the host answers)
  markHeldButtonReleased(key, button) {
    const request = this.pendingFor(key);
    if (request && request.held && request.held.button === button) {
      request.held.released = true;
      return true;
    }
    return false;
  }

  resolve(id, allow, remember = false, now = Date.now()) {
    const request = this.pending.get(id);
    if (!request) return null;
    this.pending.delete(id);
    if (allow) {
      this.approved.add(request.app.key);
      if (remember) this.remembered.add(request.app.key);
      this.denied.delete(request.app.key);
    } else {
      this.denied.set(request.app.key, now);
    }
    return { request, allowed: Boolean(allow) };
  }

  clearPending() {
    const ids = [...this.pending.keys()];
    this.pending.clear();
    return ids;
  }

  reset() {
    this.approved.clear();
    this.denied.clear();
    return this.clearPending();
  }

  resetAll() {
    this.remembered.clear();
    return this.reset();
  }
}

// Rate limiter for notices sent back to a controller (one per key per interval)
class NoticeLimiter {
  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs;
    this.last = new Map();
  }

  allow(key, now = Date.now()) {
    const last = this.last.get(key);
    if (last !== undefined && now - last < this.intervalMs) return false;
    this.last.set(key, now);
    return true;
  }
}

module.exports = {
  clamp01, isUsableRect, isMinimisedRect, rectContains, mapNormalizedToRect, resolveDisplayRect,
  captureFrameInset, insetRect, findWindowAt, classifyApp, exeBaseName, AppApprovalPolicy, NoticeLimiter,
  CLICK_THROUGH_EXES,
};
