const { app, BrowserWindow, ipcMain, clipboard, desktopCapturer, shell, globalShortcut, Notification, screen } = require('electron');
const serve = require('electron-serve');
const path = require('path');
const fs = require('fs');
const { generateReply } = require('./gemini-service');
const { mapBrowserKeyToRobotJS, mapModifiers } = require('./remoteKeyMap');
const {
  mapNormalizedToRect, resolveDisplayRect, captureFrameInset, insetRect, isMinimisedRect, findWindowAt,
  classifyApp, AppApprovalPolicy, NoticeLimiter,
} = require('./remoteAppPolicy');

const getLogPath = (filename) => {
  try {
    return path.join(app.getPath('userData'), filename);
  } catch (e) {
    const os = require('os');
    return path.join(os.tmpdir(), filename);
  }
};

process.on('uncaughtException', (err) => {
  try { fs.writeFileSync(getLogPath('electron-error.log'), err.stack); } catch(e){}
});
process.on('unhandledRejection', (reason) => {
  try { fs.writeFileSync(getLogPath('electron-rejection.log'), String(reason)); } catch(e){}
});

// Setup windowManager. The raw addon is used for bounds: its JS getBounds() divides GetWindowRect by
// the monitor scale factor, which no longer matches robotjs (physical pixels) on a scaled display.
let windowManager = null;
let nwmAddon = null;
let NwmWindow = null;
try {
  const nwm = require('node-window-manager');
  windowManager = nwm.windowManager;
  nwmAddon = nwm.addon || null;
  NwmWindow = nwm.Window || null;
} catch (e) {
  console.warn("Could not load node-window-manager plugin.", e.message);
}
// What the host is sharing: { kind: 'window', hwnd, sourceId } | { kind: 'screen', displayId, sourceId } | null
let activeShare = null;
let captureFrameSize = null; // { width, height } of the captured video, to locate the visible window inside GetWindowRect

// Setup robotjs
let robot;
try {
  robot = require('robotjs');
  robot.setMouseDelay(0);
} catch (e) {
  console.warn("Could not load robotjs plugin.", e.message);
}

// Setup vigemclient
let vigemClient = null;
let virtualGamepad = null;
try {
  const ViGEmClient = require('vigemclient');
  vigemClient = new ViGEmClient();
  if (vigemClient.connect() == null) {
    virtualGamepad = vigemClient.createX360Controller();
    virtualGamepad.connect();
    console.log('[GAMEPAD] Virtual Xbox 360 Controller connected successfully.');
  } else {
    console.warn('[GAMEPAD] ViGEmBus driver not installed or running. Gamepad disabled.');
  }
} catch (e) {
  console.warn('[GAMEPAD] Could not load vigemclient plugin. Gamepad disabled.', e.message);
}

// Global state
let clipboardGuardEnabled = false;
let pendingShareSourceId = null;
let processScanInterval = null;

// Use electron-serve to serve the static Next.js export securely
const loadURL = serve({ directory: 'out' });

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.replace(/\/$/, '') : '';
}

function getConfiguredBackendUrl() {
  const envUrl = normalizeUrl(process.env.LETSCOLLAB_BACKEND_URL);
  if (envUrl) return envUrl;

  const configPaths = [
    path.join(__dirname, 'app-config.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app-config.json') : null,
  ];
  try {
    configPaths.push(path.join(app.getPath('userData'), 'app-config.json'));
  } catch (err) {}

  for (const configPath of configPaths) {
    try {
      if (configPath && fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const backendUrl = normalizeUrl(config && (config.backendUrl || config.NEXT_PUBLIC_BACKEND_URL));
        if (backendUrl) return backendUrl;
      }
    } catch (e) {}
  }
  return 'https://let-s-collab-tjwc.onrender.com'; // Fallback
}

function isTrustedRendererUrl(value) {
  try {
    const urlObj = new URL(value);
    const isApp = urlObj.protocol === 'app:';
    const isLocalhost = urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1';
    // Installed builds only ever load the bundled app:// pages; a local dev server is trusted only
    // in unpackaged development runs, so another local web page cannot drive execute-input
    return isApp || (!app.isPackaged && isLocalhost);
  } catch (e) {
    return false;
  }
}

// A window that navigates keeps its preload API, so it may only move between trusted pages;
// web links open in the default browser instead
function lockNavigation(win) {
  const guard = (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
}

function isTrustedIpcSender(event, channel) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (isTrustedRendererUrl(senderUrl)) return true;
  console.warn(`[SECURITY] Blocked ${channel} IPC from untrusted renderer: ${senderUrl}`);
  return false;
}

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

let mainWindow = null;

// ── Panic revoke ───────────────────────────────────────────────────────────────
// The lock lives in the main process so it takes effect the instant the shortcut is pressed:
// no network round trip, and it works even if the renderer is busy. It is lifted only when the
// host grants control again from the UI (set-remote-input-lock false).
//
// The shortcuts are OS-wide hotkeys (RegisterHotKey on Windows), so they fire while any other program
// has focus, elevated (admin) programs included. They do not fire on the secure desktop (UAC prompt,
// Ctrl+Alt+Del, lock screen), where injected input cannot reach either.
const PANIC_SHORTCUTS = ['Shift+Escape', 'CommandOrControl+Alt+Escape'];
// A hotkey only matches its exact modifiers, and a modifier the controller is holding down (an injected
// Shift or Alt) is part of what the OS sees. These variants keep the emergency combos working then.
// (A held Ctrl turns Shift+Esc into Windows' own Task Manager shortcut: Ctrl+Alt+Esc still works.)
const PANIC_SHORTCUT_VARIANTS = ['Alt+Shift+Escape', 'CommandOrControl+Alt+Shift+Escape'];
let registeredPanicShortcuts = [];
let failedPanicShortcuts = [];
let remoteInputLocked = false;
const heldRemoteKeys = new Set();
const heldRemoteButtons = new Set();
// Entire-screen presses still being matched to an application: button -> { released }
const inflightRemotePresses = new Map();

// Release anything the controller was holding (a drag, Shift/Ctrl, gamepad buttons) so nothing stays pressed
function releaseHeldRemoteInput() {
  if (robot) {
    heldRemoteButtons.forEach((button) => { try { robot.mouseToggle('up', button); } catch (e) {} });
    heldRemoteKeys.forEach((key) => { try { robot.keyToggle(key, 'up'); } catch (e) {} });
    ['shift', 'control', 'alt', 'command'].forEach((key) => { try { robot.keyToggle(key, 'up'); } catch (e) {} });
  }
  heldRemoteButtons.clear();
  heldRemoteKeys.clear();
  inflightRemotePresses.clear();
  if (virtualGamepad && typeof virtualGamepad.resetInputs === 'function') {
    try { virtualGamepad.resetInputs(); } catch (e) {}
  }
}

function sendToMainWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function shortcutLabel(accelerator) {
  return String(accelerator).replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl').replace('Escape', 'Esc');
}

function triggerPanicRevoke(source) {
  // Lock first: from this instant execute-input injects nothing, whatever the renderer is doing
  remoteInputLocked = true;
  releaseHeldRemoteInput();
  resetAppApprovals(false);
  sendToMainWindow('panic-revoke-control', { source });
  announcePanicRevoke(source);
}

// The host may be in another program when they press the shortcut: confirm it where they are looking
function announcePanicRevoke(source) {
  const label = shortcutLabel(source);
  showHostOverlay(`Remote control revoked (${label}). Controllers are now view-only.`, 'alert');
  notifyHost('Remote control revoked', 'The controller is now view-only. Grant control again from Let\'s Collab.');
  flashMainWindow();
}

function registerPanicShortcuts() {
  const all = [...PANIC_SHORTCUTS, ...PANIC_SHORTCUT_VARIANTS];
  const ok = [];
  const failed = [];
  all.forEach((accelerator) => {
    let registered = false;
    try {
      registered = globalShortcut.isRegistered(accelerator) || globalShortcut.register(accelerator, () => triggerPanicRevoke(accelerator));
    } catch (e) {
      registered = false;
    }
    (registered ? ok : failed).push(accelerator);
  });
  registeredPanicShortcuts = ok;
  failedPanicShortcuts = failed;
  if (!PANIC_SHORTCUTS.some(accelerator => ok.includes(accelerator))) {
    console.warn('[PANIC] No panic shortcut could be registered (keys already taken by another app).');
  } else if (failed.length) {
    console.warn('[PANIC] Some panic shortcuts are taken by another app:', failed.join(', '));
  }
}

// ── Host-facing feedback that works while Let's Collab is in the background ────────────────────────
let hostOverlayWindow = null;
let hostOverlayTimer = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// A small always-on-top, click-through banner at the top of the screen the host is using. It never
// takes focus and is ignored by the remote click hit test, so it cannot get in the controller's way.
function showHostOverlay(message, tone = 'alert', durationMs = 4500) {
  try {
    if (!hostOverlayWindow || hostOverlayWindow.isDestroyed()) {
      hostOverlayWindow = new BrowserWindow({
        width: 560, height: 72, show: false, frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false },
      });
      hostOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      hostOverlayWindow.setIgnoreMouseEvents(true);
      hostOverlayWindow.webContents.on('will-navigate', event => event.preventDefault());
      hostOverlayWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    const colour = tone === 'alert' ? '#ef4444' : '#f59e0b';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:transparent;overflow:hidden;font:600 14px/1.35 "Segoe UI",system-ui,sans-serif}
      div{margin:6px;padding:12px 16px;border-radius:12px;background:rgba(17,17,20,.94);color:#fff;border:2px solid ${colour};
      box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center}
      b{color:${colour};font-size:18px}</style></head><body><div><b>&#9888;</b><span>${escapeHtml(message)}</span></div></body></html>`;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [width] = hostOverlayWindow.getSize();
    hostOverlayWindow.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + 16));
    hostOverlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
    hostOverlayWindow.showInactive();
    if (hostOverlayTimer) clearTimeout(hostOverlayTimer);
    hostOverlayTimer = setTimeout(() => {
      if (hostOverlayWindow && !hostOverlayWindow.isDestroyed()) hostOverlayWindow.hide();
    }, durationMs);
  } catch (e) {}
}

function notifyHost(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body, silent: false });
    notification.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  } catch (e) {}
}

function flashMainWindow() {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.flashFrame(true);
  } catch (e) {}
}

// ── Remote input targeting ─────────────────────────────────────────────────────────────────────────
// See remoteAppPolicy.js for the coordinate spaces. Windows of Let's Collab itself can never be
// operated remotely: that is what stops a controller from approving its own requests or raising its
// own permission from the host's panel.
const appApprovals = new AppApprovalPolicy({ enabled: true });
const controllerNotices = new NoticeLimiter(3000);
let petIgnoresMouse = true;

function nativeWindowId(win) {
  try {
    if (!win || win.isDestroyed()) return null;
    const handle = win.getNativeWindowHandle();
    return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
  } catch (e) {
    return null;
  }
}

// Own windows that let clicks fall through to whatever is below them
function clickThroughOwnWindowIds() {
  const ids = new Set();
  const overlayId = hostOverlayWindow && !hostOverlayWindow.isDestroyed() ? nativeWindowId(hostOverlayWindow) : null;
  if (overlayId !== null) ids.add(overlayId);
  if (petIgnoresMouse) {
    const petId = nativeWindowId(petWindow);
    if (petId !== null) ids.add(petId);
  }
  return ids;
}

function describeWindow(id) {
  if (!nwmAddon || !nwmAddon.initWindow) return null;
  const info = nwmAddon.initWindow(id) || {};
  let title = '';
  try { title = nwmAddon.getWindowTitle ? String(nwmAddon.getWindowTitle(id) || '') : ''; } catch (e) {}
  return { processId: info.processId, path: info.path || '', title };
}

function classifyWindow(id) {
  if (id === null || id === undefined) return classifyApp(null);
  try {
    return classifyApp(describeWindow(id), { ownPid: process.pid, platform: process.platform });
  } catch (e) {
    return classifyApp(null);
  }
}

// The application that a click at physical (x, y) reaches. Falls back to "Unknown application" where
// the window list is not available (Linux, or macOS without the Accessibility permission).
// Windows: the screen capturer's window list is the only cheap way to tell cloaked windows (lock screen,
// closed Start menu...) from shown ones, so it is refreshed in the background during an entire-screen share
const shownWindowList = { ids: null, at: 0, refreshing: null, timer: null };

function refreshShownWindowList() {
  if (process.platform !== 'win32') return Promise.resolve();
  if (shownWindowList.refreshing) return shownWindowList.refreshing;
  shownWindowList.refreshing = desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    .then((sources) => {
      const ids = new Set();
      (sources || []).forEach((source) => {
        const id = Number(String(source.id).split(':')[1]);
        if (Number.isFinite(id)) ids.add(id);
      });
      shownWindowList.ids = ids;
      shownWindowList.at = Date.now();
    })
    .catch(() => {})
    .finally(() => { shownWindowList.refreshing = null; });
  return shownWindowList.refreshing;
}

function startShownWindowRefresh() {
  if (process.platform !== 'win32' || shownWindowList.timer) return;
  refreshShownWindowList();
  shownWindowList.timer = setInterval(refreshShownWindowList, 1500);
}

function stopShownWindowRefresh() {
  if (shownWindowList.timer) clearInterval(shownWindowList.timer);
  shownWindowList.timer = null;
  shownWindowList.ids = null;
  shownWindowList.at = 0;
}

// Resolves once the list is recent enough to hit-test against (waits at most ~2.5 s)
function ensureShownWindowList() {
  startShownWindowRefresh();
  if (process.platform !== 'win32' || (shownWindowList.ids && Date.now() - shownWindowList.at < 5000)) return Promise.resolve();
  return Promise.race([refreshShownWindowList(), new Promise(resolve => setTimeout(resolve, 2500))]);
}

function appAtPoint(x, y) {
  if (!nwmAddon || !nwmAddon.getWindows || !nwmAddon.getWindowBounds) return { app: classifyApp(null), hwnd: null };
  try {
    let foregroundId = null;
    let foregroundPid = null;
    try {
      foregroundId = nwmAddon.getActiveWindow ? nwmAddon.getActiveWindow() : null;
      const info = foregroundId ? describeWindow(foregroundId) : null;
      foregroundPid = info ? info.processId : null;
    } catch (e) {}
    const hit = findWindowAt(nwmAddon.getWindows(), x, y, {
      isVisible: id => (nwmAddon.isWindowVisible ? nwmAddon.isWindowVisible(id) : true),
      getBounds: id => nwmAddon.getWindowBounds(id),
      describe: id => describeWindow(id),
      skipIds: clickThroughOwnWindowIds(),
      // Without a capturer list yet, nothing is known to be shown: fail towards "Unknown application"
      visibleIds: process.platform === 'win32' ? (shownWindowList.ids || new Set()) : null,
      foregroundId,
      foregroundPid,
      ownPid: process.pid,
    });
    if (!hit) return { app: classifyApp(null), hwnd: null };
    return { app: classifyApp(hit, { ownPid: process.pid, platform: process.platform }), hwnd: hit.id };
  } catch (e) {
    return { app: classifyApp(null), hwnd: null };
  }
}

// The application that keystrokes reach (the foreground window)
function activeApp() {
  if (!nwmAddon || !nwmAddon.getActiveWindow) return { app: classifyApp(null), hwnd: null };
  try {
    const hwnd = nwmAddon.getActiveWindow();
    return { app: classifyWindow(hwnd), hwnd };
  } catch (e) {
    return { app: classifyApp(null), hwnd: null };
  }
}

function bringWindowForward(hwnd, restore = false) {
  if (!NwmWindow || !nwmAddon || hwnd === null || hwnd === undefined) return;
  try {
    const win = new NwmWindow(hwnd);
    if (restore) win.restore();
    win.bringToTop();
  } catch (e) {}
}

function noticeController(controllerId, code, message) {
  if (!controllerNotices.allow(`${controllerId || '*'}|${code}`)) return;
  sendToMainWindow('remote-input-notice', { controllerId: controllerId || null, code, message });
}

function resetAppApprovals(all) {
  const ids = all ? appApprovals.resetAll() : appApprovals.reset();
  sendToMainWindow('remote-app-approval-clear', { ids });
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false); } catch (e) {}
}

// The display behind an entire-screen share, in robotjs coordinates (primary display as a fallback)
function sharedScreenRect() {
  if (activeShare && activeShare.kind === 'screen' && activeShare.displayId) {
    try {
      const rect = resolveDisplayRect({
        displays: screen.getAllDisplays(),
        displayId: activeShare.displayId,
        platform: process.platform,
        dipToScreenRect: typeof screen.dipToScreenRect === 'function' ? bounds => screen.dipToScreenRect(null, bounds) : null,
      });
      if (rect) return rect;
    } catch (e) {}
  }
  const size = robot.getScreenSize();
  return { x: 0, y: 0, width: size.width, height: size.height };
}

// The shared window's visible area in robotjs coordinates, or why input cannot reach it
function sharedWindowState() {
  const hwnd = activeShare.hwnd;
  if (!nwmAddon || !nwmAddon.getWindowBounds) return { status: 'unavailable' };
  try {
    if (process.platform === 'win32' && nwmAddon.isWindow && !nwmAddon.isWindow(hwnd)) return { status: 'closed' };
    if (activeShare.processId === undefined) {
      const info = describeWindow(hwnd);
      activeShare.processId = info ? info.processId : null;
    }
    if (activeShare.processId === process.pid) return { status: 'own' };
    const bounds = nwmAddon.getWindowBounds(hwnd);
    if (isMinimisedRect(bounds)) return { status: 'minimised' };
    const inset = captureFrameSize ? captureFrameInset(bounds, captureFrameSize.width, captureFrameSize.height, 24) : null;
    return { status: 'ok', rect: inset ? insetRect(bounds, inset) : bounds };
  } catch (e) {
    return { status: 'closed' };
  }
}

// Keyboard and clicks must reach the shared window, which is usually behind Let's Collab or another
// program: raise it unless its program is already in front (an open dialog of it counts)
function ensureSharedWindowForeground() {
  if (!nwmAddon || !nwmAddon.getActiveWindow) return;
  try {
    const activeHwnd = nwmAddon.getActiveWindow();
    if (activeHwnd === activeShare.hwnd) return;
    const info = describeWindow(activeHwnd);
    if (info && activeShare.processId !== undefined && activeShare.processId !== null && info.processId === activeShare.processId) return;
    bringWindowForward(activeShare.hwnd);
  } catch (e) {}
}

async function requestAppApproval(target, hwnd, payload, held, trigger) {
  const request = appApprovals.request(target, {
    controllerId: payload.controllerId || null,
    controllerName: String(payload.controllerName || 'The controller').slice(0, 80),
    hwnd,
    trigger,
  }, held);
  let icon = null;
  if (target.path) {
    try {
      const image = await Promise.race([
        app.getFileIcon(target.path, { size: 'normal' }),
        new Promise(resolve => setTimeout(() => resolve(null), 500)),
      ]);
      icon = image && !image.isEmpty() ? image.toDataURL() : null;
    } catch (e) {}
  }
  if (!appApprovals.pending.has(request.id)) return; // answered or cleared meanwhile
  const who = request.meta.controllerName;
  sendToMainWindow('remote-app-approval-request', {
    id: request.id, appName: target.name, appKind: target.kind, exePath: target.path || '', icon,
    controllerId: request.meta.controllerId, controllerName: who, trigger,
  });
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) {
    showHostOverlay(`${who} wants to use ${target.name}. Open Let's Collab to allow or deny.`, 'warn', 6000);
    notifyHost('Approval needed', `${who} wants to use ${target.name}. Click to open Let's Collab and allow or deny.`);
    flashMainWindow();
  }
  noticeController(request.meta.controllerId, `asked:${target.key}`, `Asked the host for permission to use ${target.name}...`);
}

// Gate one entire-screen action on the host's approval of the application it reaches.
// Returns true when the action may be injected now.
function approveEntireScreenAction(target, hwnd, payload, held, trigger) {
  const verdict = appApprovals.check(target);
  if (verdict === 'allow') return true;
  const controllerId = payload.controllerId || null;
  if (verdict === 'own') {
    noticeController(controllerId, 'own-window', "Let's Collab's own window can't be controlled remotely.");
  } else if (verdict === 'pending') {
    noticeController(controllerId, `pending:${target.key}`, `Waiting for the host to allow ${target.name}...`);
  } else if (verdict === 'denied') {
    noticeController(controllerId, `denied:${target.key}`, `The host denied access to ${target.name}.`);
  } else {
    requestAppApproval(target, hwnd, payload, held, trigger);
  }
  return false;
}

// Host answered an approval request: on Allow, raise the window (the host just clicked in Let's Collab,
// which is now in front of it) and replay the click that was held back
function replayHeldClick(request) {
  const held = request.held;
  // Also for a keyboard request: typing should go to the allowed app, not to Let's Collab
  if (request.meta.hwnd !== null && request.meta.hwnd !== undefined) bringWindowForward(request.meta.hwnd);
  if (!held || !robot) return;
  setTimeout(() => {
    if (remoteInputLocked) return;
    const { app: target } = appAtPoint(held.x, held.y);
    if (target.key !== request.app.key) {
      noticeController(request.meta.controllerId, 'replay-moved', `${request.app.name} is allowed. Click again: the window is no longer under the pointer.`);
      return;
    }
    try {
      robot.moveMouse(held.x, held.y);
      robot.mouseToggle('down', held.button);
      if (held.released) robot.mouseToggle('up', held.button);
      else heldRemoteButtons.add(held.button);
    } catch (e) {}
  }, 120);
}
let petWindow = null;
let petEnabled = true;

function createWindow() {
  const backendUrl = getConfiguredBackendUrl();
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // The taskbar otherwise borrows the icon of whichever Start Menu shortcut matches the app id,
    // which shows a blank icon when an old install left a broken shortcut behind
    icon: path.join(__dirname, 'public', process.platform === 'win32' ? 'logo.ico' : 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      // A host sharing its screen usually has another app in front; a throttled background page
      // starves the session socket and the call, and the server then drops the connection
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendUrl ? [`--letscollab-backend-url=${backendUrl}`] : []
    }
  });

  // Spoof the Origin header to bypass CORS on older backend deployments
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      details.requestHeaders['Origin'] = 'http://localhost:8081';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  // Load the app through electron-serve (app://-/app.html)
  loadURL(mainWindow).then(() => {
    mainWindow.loadURL('app://-/app.html');
  }).catch(err => {
    console.error('Failed to load local app UI:', err);
  });

  // Pet window
  petWindow = new BrowserWindow({
    width: 280,
    height: 380,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      // A host sharing its screen usually has another app in front; a throttled background page
      // starves the session socket and the call, and the server then drops the connection
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendUrl ? [`--letscollab-backend-url=${backendUrl}`] : []
    }
  });

  lockNavigation(petWindow);
  petWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  loadURL(petWindow).then(() => {
    petWindow.loadURL('app://-/pet.html');
    petWindow.hide();
    petWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  // Window Events
  mainWindow.on('focus', () => { try { mainWindow.flashFrame(false); } catch (e) {} });
  mainWindow.on('minimize', () => { if (petWindow && petEnabled) petWindow.show(); });
  mainWindow.on('restore', () => { if (petWindow) petWindow.hide(); });
  mainWindow.on('closed', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); });

  // Security checks
  lockNavigation(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Permissions (WebRTC)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'display-capture'];
    callback(allowed.includes(permission) && isTrustedRendererUrl(webContents.getURL()));
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'display-capture'];
    return allowed.includes(permission) && isTrustedRendererUrl(webContents.getURL());
  });

  mainWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 1, height: 1 } }).then((sources) => {
      sources = sources || [];
      let chosen = null;
      // The picked source stays selected (until the share ends) so the page's retry without audio
      // shares the same window instead of silently falling back to the entire screen
      if (pendingShareSourceId) {
        chosen = sources.find(s => s.id === pendingShareSourceId) || null;
      }
      if (!chosen && sources.length > 0) chosen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      
      if (chosen) {
        const response = { video: chosen };
        if (request.audioRequested) response.audio = 'loopback';
        callback(response);
      } else {
        callback();
      }
    }).catch(() => callback());
  });

  // Anti-Cheat: Blur
  mainWindow.on('blur', () => {
    mainWindow.webContents.send('system-event', { type: 'BLUR_EVENT', message: 'User switched away from the collaboration window' });
  });

  // Anti-Cheat: Clipboard
  let previousClipboardText = clipboard.readText();
  setInterval(() => {
    const currentText = clipboard.readText();
    if (currentText !== previousClipboardText && currentText.trim().length > 0) {
      previousClipboardText = currentText;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-event', { type: 'CLIPBOARD_CHANGE', message: 'Clipboard activity detected' });
      }
      if (clipboardGuardEnabled) {
        clipboard.clear();
        previousClipboardText = '';
      }
    }
  }, 1000);
}

// Native notifications on Windows are attributed to the app id (the installer registers the same one)
if (process.platform === 'win32') app.setAppUserModelId('com.letscollab.app');

app.whenReady().then(() => {
  createWindow();

  registerPanicShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('gemini:ask', async (event, prompt, codeContext) => {
  if (!isTrustedIpcSender(event, 'gemini:ask')) return '';
  return generateReply(prompt, codeContext);
});

ipcMain.handle('oauth-login', async (event, provider) => {
  if (!isTrustedIpcSender(event, 'oauth-login')) return false;
  if (provider !== 'google' && provider !== 'github') return false;
  const backendUrl = getConfiguredBackendUrl();
  const authUrl = `${backendUrl}/api/auth/${provider}`;
  
  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
      width: 600,
      height: 800,
      parent: mainWindow,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Spoof Origin for backend CORS if necessary
    authWindow.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        details.requestHeaders['Origin'] = 'http://localhost:8081';
        callback({ cancel: false, requestHeaders: details.requestHeaders });
      }
    );

    authWindow.loadURL(authUrl);
    
    // The backend redirects to /app?oauth=success#token=... (or ?oauth=error): hand that address to
    // the app, which reads the token from it like the web app does
    let settled = false;
    const handleNavigation = (url) => {
      try {
        const urlObj = new URL(url);
        const outcome = urlObj.searchParams.get('oauth');
        if (outcome === 'success' || outcome === 'error' || urlObj.searchParams.get('error')) {
          settled = true;
          resolve(url);
          authWindow.close();
        }
      } catch (e) {}
    };

    authWindow.webContents.on('will-redirect', (e, url) => handleNavigation(url));
    authWindow.webContents.on('did-navigate', (e, url) => handleNavigation(url));
    
    authWindow.on('closed', () => {
      if (!settled) resolve(false);
    });
  });
});

ipcMain.on('pet-state-update', (event, data) => {
  if (!isTrustedIpcSender(event, 'pet-state-update')) return;
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet-sync-state', data);
});

ipcMain.on('set-pet-enabled', (event, enabled) => {
  if (!isTrustedIpcSender(event, 'set-pet-enabled')) return;
  petEnabled = enabled;
  if (petWindow && !petWindow.isDestroyed()) {
    if (!enabled) petWindow.hide();
    else if (mainWindow && mainWindow.isMinimized()) petWindow.show();
  }
});

ipcMain.on('move-pet-window', (event, { x, y }) => {
  if (!isTrustedIpcSender(event, 'move-pet-window')) return;
  if (petWindow && !petWindow.isDestroyed()) {
    const [currentX, currentY] = petWindow.getPosition();
    petWindow.setPosition(Math.round(currentX + x), Math.round(currentY + y));
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
  if (!isTrustedIpcSender(event, 'set-ignore-mouse-events')) return;
  if (petWindow && !petWindow.isDestroyed()) {
    petIgnoresMouse = Boolean(ignore);
    petWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('get-shareable-sources', async (event) => {
  // Thumbnails of every window and screen: only for the app's own pages
  if (!isTrustedIpcSender(event, 'get-shareable-sources')) return [];
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 300, height: 200 }, fetchWindowIcons: true });
    let screenIndex = 0;
    return (sources || []).map((source, index) => {
      const isScreen = String(source.id).startsWith('screen:');
      const name = isScreen ? `Screen ${++screenIndex}` : String(source.name || `Window ${index + 1}`).trim();
      return {
        id: source.id, name, display_id: source.display_id || null,
        thumbnail: source.thumbnail && typeof source.thumbnail.toDataURL === 'function' ? source.thumbnail.toDataURL() : null,
        isScreen,
      };
    });
  } catch (err) {
    return [];
  }
});

// Which window or display a desktopCapturer source id ("window:<HWND>:0" / "screen:<n>:0") stands for
async function describeShareSource(sourceId) {
  if (!sourceId) return null;
  if (sourceId.startsWith('window:')) {
    const hwnd = Number(sourceId.split(':')[1]);
    return Number.isFinite(hwnd) && hwnd !== 0 ? { kind: 'window', hwnd, sourceId } : null;
  }
  if (sourceId.startsWith('screen:')) {
    let displayId = null;
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      const match = (sources || []).find(source => source.id === sourceId);
      displayId = match && match.display_id ? match.display_id : null;
    } catch (e) {}
    return { kind: 'screen', displayId, sourceId };
  }
  return null;
}

ipcMain.handle('set-share-source', async (event, sourceId) => {
  if (!isTrustedIpcSender(event, 'set-share-source')) return false;
  pendingShareSourceId = typeof sourceId === 'string' ? sourceId : null;
  captureFrameSize = null;
  // A new share starts with no approved applications
  resetAppApprovals(false);
  activeShare = await describeShareSource(pendingShareSourceId);
  stopShownWindowRefresh();
  if (activeShare && activeShare.kind === 'screen') startShownWindowRefresh();
  // macOS: window positions and the window list need the Accessibility permission (asks once)
  if (process.platform === 'darwin' && windowManager && activeShare) {
    try { windowManager.requestAccessibility(); } catch (e) {}
  }
  return true;
});

// Size of the captured video, used to find the visible window inside GetWindowRect (see captureFrameInset)
ipcMain.on('set-share-capture-size', (event, size) => {
  if (!isTrustedIpcSender(event, 'set-share-capture-size')) return;
  const width = Number(size && size.width);
  const height = Number(size && size.height);
  captureFrameSize = width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : null;
});

// The share stopped (or the host left the session): forget the source and every approval
ipcMain.on('remote-share-ended', (event, info) => {
  if (!isTrustedIpcSender(event, 'remote-share-ended')) return;
  activeShare = null;
  pendingShareSourceId = null;
  captureFrameSize = null;
  stopShownWindowRefresh();
  releaseHeldRemoteInput();
  resetAppApprovals(Boolean(info && info.sessionEnded));
});

// Host toggle: "Ask me before the controller uses a new app" (entire-screen shares)
ipcMain.on('set-remote-app-policy', (event, options) => {
  if (!isTrustedIpcSender(event, 'set-remote-app-policy')) return;
  const ids = appApprovals.setEnabled(!(options && options.enabled === false));
  if (ids.length) sendToMainWindow('remote-app-approval-clear', { ids });
});

ipcMain.on('remote-app-approval-response', (event, response) => {
  if (!isTrustedIpcSender(event, 'remote-app-approval-response')) return;
  if (!response || typeof response.id !== 'string') return;
  const result = appApprovals.resolve(response.id, response.allow === true, response.remember === true);
  if (!result) return;
  const { request, allowed } = result;
  if (!appApprovals.pending.size) {
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(false); } catch (e) {}
  }
  if (allowed) {
    noticeController(request.meta.controllerId, `allowed:${request.app.key}`, `The host allowed ${request.app.name}.`);
    if (!remoteInputLocked) replayHeldClick(request);
  } else {
    noticeController(request.meta.controllerId, `denied:${request.app.key}`, `The host denied access to ${request.app.name}.`);
  }
});

ipcMain.on('toggle-fullscreen', (event) => {
  if (!isTrustedIpcSender(event, 'toggle-fullscreen')) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

// Remote-control, remote-desktop and screen-recording programs looked for during a supervised exam
const EXAM_BANNED_PROCESSES = [
  'teamviewer', 'anydesk', 'rustdesk', 'remoting_host', 'parsecd', 'parsec', 'vncserver', 'winvnc', 'tvnserver',
  'ultravnc', 'splashtop', 'ammyy', 'supremo', 'zohoassist', 'logmein', 'screenconnect', 'obs64', 'obs', 'discord',
];

// The exam page asks for the process scan with { scan: true } (kiosk stays as it is); the original
// boolean form still turns kiosk mode and the scan on or off together.
ipcMain.on('enable-kiosk-mode', (event, options) => {
  if (!isTrustedIpcSender(event, 'enable-kiosk-mode')) return;
  const settings = typeof options === 'boolean' ? { kiosk: options, scan: options } : (options || {});
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof settings.kiosk === 'boolean') {
    win.setKiosk(settings.kiosk);
    win.setAlwaysOnTop(settings.kiosk, 'screen-saver');
  }
  if (typeof settings.scan !== 'boolean') return;
  if (processScanInterval) clearInterval(processScanInterval);
  processScanInterval = null;
  if (!settings.scan) return;

  const sender = event.sender;
  const reported = new Set();
  const alert = (key, payload) => {
    if (reported.has(key) || sender.isDestroyed()) return;
    reported.add(key);
    sender.send('anticheat-alert', payload);
  };
  const scan = () => {
    // A Windows Remote Desktop session runs the whole exam on another computer's screen
    if (process.platform === 'win32' && /^rdp-/i.test(process.env.SESSIONNAME || '')) {
      alert('rdp', { type: 'REMOTE_DESKTOP', message: 'The exam is running inside a Remote Desktop (RDP) session', penalty: 30 });
    }
    const command = process.platform === 'win32' ? 'tasklist /fo csv /nh' : 'ps -A -o comm=';
    require('child_process').exec(command, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) return;
      const names = new Set(stdout.split(/\r?\n/).map(line => {
        const raw = process.platform === 'win32' ? (line.split('","')[0] || '').replace(/^"/, '') : line.trim().split('/').pop();
        return String(raw || '').toLowerCase().replace(/\.exe$/, '');
      }).filter(Boolean));
      EXAM_BANNED_PROCESSES.forEach(proc => {
        if (names.has(proc)) alert(proc, { type: 'BANNED_PROCESS', message: `Remote-control or recording program running: ${proc}`, penalty: 30 });
      });
    });
  };
  scan();
  processScanInterval = setInterval(scan, 10000);
});

ipcMain.on('set-clipboard-guard', (event, locked) => {
  if (!isTrustedIpcSender(event, 'set-clipboard-guard')) return;
  clipboardGuardEnabled = Boolean(locked);
  if (clipboardGuardEnabled) clipboard.clear();
});

// Remote Input (RobotJS / ViGEmClient)
ipcMain.handle('get-panic-shortcuts', (event) => (
  isTrustedIpcSender(event, 'get-panic-shortcuts') ? PANIC_SHORTCUTS.filter(key => registeredPanicShortcuts.includes(key)) : []
));

// Which emergency shortcuts work system-wide. Retries any that another program had taken.
ipcMain.handle('get-panic-shortcut-status', (event) => {
  if (!isTrustedIpcSender(event, 'get-panic-shortcut-status')) return null;
  if (failedPanicShortcuts.length) registerPanicShortcuts();
  return {
    registered: PANIC_SHORTCUTS.filter(key => registeredPanicShortcuts.includes(key)),
    failed: PANIC_SHORTCUTS.filter(key => failedPanicShortcuts.includes(key)),
    variants: PANIC_SHORTCUT_VARIANTS.filter(key => registeredPanicShortcuts.includes(key)),
    platform: process.platform,
  };
});

ipcMain.on('set-remote-input-lock', (event, locked) => {
  if (!isTrustedIpcSender(event, 'set-remote-input-lock')) return;
  remoteInputLocked = Boolean(locked);
  if (remoteInputLocked) {
    releaseHeldRemoteInput();
    // Revoking control also forgets which applications were approved
    resetAppApprovals(false);
  }
});

ipcMain.on('execute-input', (event, payload) => {
  if (!isTrustedIpcSender(event, 'execute-input')) return;
  if (!payload || typeof payload !== 'object') return;
  if (remoteInputLocked) return;

  if (payload.type === 'gamepad-state') {
    if (virtualGamepad) {
      try {
        if (payload.axes && payload.axes.length >= 4) {
          virtualGamepad.axis.leftX.setValue(clampNumber(payload.axes[0], -1, 1));
          virtualGamepad.axis.leftY.setValue(-clampNumber(payload.axes[1], -1, 1));
          virtualGamepad.axis.rightX.setValue(clampNumber(payload.axes[2], -1, 1));
          virtualGamepad.axis.rightY.setValue(-clampNumber(payload.axes[3], -1, 1));
        }
        if (payload.buttons && payload.buttons.length >= 17) {
          virtualGamepad.button.A.setValue(Boolean(payload.buttons[0].pressed));
          virtualGamepad.button.B.setValue(Boolean(payload.buttons[1].pressed));
          virtualGamepad.button.X.setValue(Boolean(payload.buttons[2].pressed));
          virtualGamepad.button.Y.setValue(Boolean(payload.buttons[3].pressed));
          virtualGamepad.button.LEFT_SHOULDER.setValue(Boolean(payload.buttons[4].pressed));
          virtualGamepad.button.RIGHT_SHOULDER.setValue(Boolean(payload.buttons[5].pressed));
          virtualGamepad.axis.leftTrigger.setValue(clampNumber(payload.buttons[6].value, 0, 1));
          virtualGamepad.axis.rightTrigger.setValue(clampNumber(payload.buttons[7].value, 0, 1));
          virtualGamepad.button.BACK.setValue(Boolean(payload.buttons[8].pressed));
          virtualGamepad.button.START.setValue(Boolean(payload.buttons[9].pressed));
          virtualGamepad.button.LEFT_THUMB.setValue(Boolean(payload.buttons[10].pressed));
          virtualGamepad.button.RIGHT_THUMB.setValue(Boolean(payload.buttons[11].pressed));
          virtualGamepad.button.D_UP.setValue(Boolean(payload.buttons[12].pressed));
          virtualGamepad.button.D_DOWN.setValue(Boolean(payload.buttons[13].pressed));
          virtualGamepad.button.D_LEFT.setValue(Boolean(payload.buttons[14].pressed));
          virtualGamepad.button.D_RIGHT.setValue(Boolean(payload.buttons[15].pressed));
          virtualGamepad.button.GUIDE.setValue(Boolean(payload.buttons[16].pressed));
        }
      } catch (err) {}
    }
    return;
  }

  if (!robot) return;
  const controllerId = payload.controllerId || null;
  const type = payload.type;
  const button = payload.button === 2 ? 'right' : 'left';

  // Releases always go through for whatever is held, so nothing stays pressed on the host
  if (type === 'mouseup') {
    try {
      if (inflightRemotePresses.has(button)) {
        inflightRemotePresses.get(button).released = true;
      } else if (heldRemoteButtons.has(button)) {
        robot.mouseToggle('up', button);
        heldRemoteButtons.delete(button);
      } else {
        // The press is waiting for the host's approval: replay it later as a whole click
        appApprovals.pending.forEach(request => appApprovals.markHeldButtonReleased(request.app.key, button));
      }
    } catch (err) {}
    return;
  }
  if (type === 'keyup') {
    const mappedKey = payload.key ? mapBrowserKeyToRobotJS(payload.key, payload.code) : null;
    if (mappedKey && heldRemoteKeys.has(mappedKey)) {
      try { robot.keyToggle(mappedKey, 'up', mapModifiers(payload.modifiers)); } catch (err) {}
      heldRemoteKeys.delete(mappedKey);
    }
    return;
  }

  try {
    const isWindowShare = Boolean(activeShare && activeShare.kind === 'window');
    let rect;
    if (isWindowShare) {
      const state = sharedWindowState();
      if (state.status !== 'ok') {
        if (state.status === 'minimised') {
          if (type === 'mousedown' || type === 'keydown') {
            bringWindowForward(activeShare.hwnd, true);
            noticeController(controllerId, 'window-minimised', 'The shared window was minimised. It is being restored: try again in a moment.');
          }
        } else if (state.status === 'closed') {
          noticeController(controllerId, 'window-closed', 'The shared window was closed. Ask the host to share again.');
        } else if (state.status === 'own') {
          noticeController(controllerId, 'own-window', "Let's Collab's own window can't be controlled remotely.");
        } else {
          noticeController(controllerId, 'window-unavailable', 'Controlling a single shared window is not supported on this host. Ask the host to share the entire screen.');
        }
        return;
      }
      rect = state.rect;
    } else {
      rect = sharedScreenRect();
    }
    const point = mapNormalizedToRect(payload.x, payload.y, rect);

    switch (type) {
      case 'mousemove':
        if (point) robot.moveMouse(point.x, point.y);
        break;
      case 'mousedown': {
        if (!point) break;
        if (isWindowShare) {
          // The shared window is usually behind Let's Collab or another program: raise it first
          ensureSharedWindowForeground();
          const { app: target } = appAtPoint(point.x, point.y);
          if (target.kind === 'own') {
            noticeController(controllerId, 'own-window-cover', "Let's Collab is covering the shared window on the host. Ask the host to minimise it.");
            break;
          }
        } else {
          // Entire screen: find the application under the point once the list of shown windows is
          // current (usually immediately; a release that arrives meanwhile is applied afterwards)
          const press = { released: false };
          inflightRemotePresses.set(button, press);
          ensureShownWindowList().then(() => {
            if (inflightRemotePresses.get(button) === press) inflightRemotePresses.delete(button);
            if (remoteInputLocked) return;
            const { app: target, hwnd } = appAtPoint(point.x, point.y);
            const held = { x: point.x, y: point.y, button, released: press.released };
            if (!approveEntireScreenAction(target, hwnd, payload, held, 'click')) return;
            robot.moveMouse(point.x, point.y);
            robot.mouseToggle('down', button);
            if (press.released) robot.mouseToggle('up', button);
            else heldRemoteButtons.add(button);
          }).catch(() => {});
          break;
        }
        robot.moveMouse(point.x, point.y);
        robot.mouseToggle('down', button);
        heldRemoteButtons.add(button);
        break;
      }
      case 'wheel': {
        if (!point) break;
        if (!isWindowShare) {
          if (process.platform === 'win32' && !shownWindowList.ids) {
            ensureShownWindowList();
            break;
          }
          const { app: target, hwnd } = appAtPoint(point.x, point.y);
          if (!approveEntireScreenAction(target, hwnd, payload, null, 'scroll')) break;
        }
        robot.scrollMouse(0, payload.deltaY > 0 ? -1 : 1);
        break;
      }
      case 'keydown': {
        // Every key is passed through: what a controller may do is the host's choice of permission,
        // the host's approval of each application, and Shift+Esc / Ctrl+Alt+Esc at any moment
        const mappedKey = payload.key ? mapBrowserKeyToRobotJS(payload.key, payload.code) : null;
        if (!mappedKey) break;
        if (isWindowShare) {
          ensureSharedWindowForeground();
          if (activeApp().app.kind === 'own') {
            noticeController(controllerId, 'own-window-focus', "Typing would go to Let's Collab on the host: the shared window couldn't be brought to the front. Click inside it first.");
            break;
          }
        } else {
          const { app: target, hwnd } = activeApp();
          if (!approveEntireScreenAction(target, hwnd, payload, null, 'keyboard')) break;
        }
        robot.keyToggle(mappedKey, 'down', mapModifiers(payload.modifiers));
        heldRemoteKeys.add(mappedKey);
        break;
      }
    }
  } catch (err) {}
});

