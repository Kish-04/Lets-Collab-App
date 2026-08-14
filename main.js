const { app, BrowserWindow, ipcMain, clipboard, desktopCapturer, shell } = require('electron');
const serve = require('electron-serve');
const path = require('path');
const fs = require('fs');
const { generateReply } = require('./gemini-service');

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
  return 'https://let-s-collab-tjwc.onrender.com';
}

function isTrustedRendererUrl(value) {
  try {
    const origin = new URL(value).origin;
    return origin === 'app://-' || origin.includes('localhost') || origin.includes('127.0.0.1');
  } catch (e) {
    return false;
  }
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
let petWindow = null;
let petEnabled = true;

function createWindow() {
  const backendUrl = getConfiguredBackendUrl();
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendUrl ? [`--letscollab-backend-url=${backendUrl}`] : []
    }
  });

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
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendUrl ? [`--letscollab-backend-url=${backendUrl}`] : []
    }
  });

  loadURL(petWindow).then(() => {
    petWindow.loadURL('app://-/pet.html');
    petWindow.hide();
  });

  // Window Events
  mainWindow.on('minimize', () => { if (petWindow && petEnabled) petWindow.show(); });
  mainWindow.on('restore', () => { if (petWindow) petWindow.hide(); });
  mainWindow.on('closed', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); });

  // Security checks
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
      if (pendingShareSourceId) {
        chosen = sources.find(s => s.id === pendingShareSourceId) || null;
        pendingShareSourceId = null;
      }
      if (!chosen && sources.length > 0) chosen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      
      if (chosen) {
        callback({ video: chosen, audio: request.audioRequested ? 'loopback' : false });
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('gemini:ask', async (event, prompt) => {
  return generateReply(prompt);
});

ipcMain.on('pet-state-update', (event, data) => {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet-sync-state', data);
});

ipcMain.on('set-pet-enabled', (event, enabled) => {
  petEnabled = enabled;
  if (petWindow && !petWindow.isDestroyed()) {
    if (!enabled) petWindow.hide();
    else if (mainWindow && mainWindow.isMinimized()) petWindow.show();
  }
});

ipcMain.on('move-pet-window', (event, { x, y }) => {
  if (petWindow && !petWindow.isDestroyed()) {
    const [currentX, currentY] = petWindow.getPosition();
    petWindow.setPosition(Math.round(currentX + x), Math.round(currentY + y));
  }
});

ipcMain.handle('get-shareable-sources', async () => {
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

ipcMain.handle('set-share-source', (_event, sourceId) => {
  pendingShareSourceId = typeof sourceId === 'string' ? sourceId : null;
  return true;
});

ipcMain.on('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('enable-kiosk-mode', (event, enable) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setKiosk(enable);
    win.setAlwaysOnTop(enable, 'screen-saver');
  }
  if (enable) {
    const exec = require('child_process').exec;
    const badProcesses = ['obs64.exe', 'TeamViewer.exe', 'AnyDesk.exe', 'Discord.exe'];
    processScanInterval = setInterval(() => {
      exec('tasklist', (err, stdout) => {
        if (!err && stdout) {
          badProcesses.forEach(proc => {
            if (stdout.toLowerCase().includes(proc.toLowerCase())) {
              event.sender.send('anticheat-alert', { type: 'BANNED_PROCESS', message: `Banned process running: ${proc}`, penalty: 30 });
            }
          });
        }
      });
    }, 10000);
  } else {
    if (processScanInterval) clearInterval(processScanInterval);
  }
});

ipcMain.on('set-clipboard-guard', (event, locked) => {
  if (!isTrustedIpcSender(event, 'set-clipboard-guard')) return;
  clipboardGuardEnabled = Boolean(locked);
  if (clipboardGuardEnabled) clipboard.clear();
});

// Remote Input (RobotJS / ViGEmClient)
ipcMain.on('execute-input', (event, payload) => {
  if (!isTrustedIpcSender(event, 'execute-input')) return;
  if (!payload || typeof payload !== 'object') return;

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

  try {
    const screenSize = robot.getScreenSize();
    const realX = Math.round(clampNumber(payload.x, 0, 1) * screenSize.width);
    const realY = Math.round(clampNumber(payload.y, 0, 1) * screenSize.height);

    switch (payload.type) {
      case 'mousemove': robot.moveMouse(realX, realY); break;
      case 'mousedown': robot.mouseToggle("down", payload.button === 2 ? "right" : "left"); break;
      case 'mouseup': robot.mouseToggle("up", payload.button === 2 ? "right" : "left"); break;
      case 'wheel': robot.scrollMouse(0, payload.deltaY > 0 ? -1 : 1); break;
      case 'keydown':
      case 'keyup':
        if (payload.key) {
           const mappedKey = mapBrowserKeyToRobotJS(payload.key, payload.code);
           if (mappedKey) {
             const modifiers = mapModifiers(payload.modifiers);
             robot.keyToggle(mappedKey, payload.type === 'keydown' ? 'down' : 'up', modifiers);
           }
        }
        break;
    }
  } catch (err) {}
});

function mapModifiers(mods) {
  if (!mods) return [];
  const active = [];
  if (mods.shift) active.push('shift');
  if (mods.ctrl) active.push('ctrl');
  if (mods.alt) active.push('alt');
  if (mods.meta) active.push('command');
  return active;
}

function mapBrowserKeyToRobotJS(key, code) {
  const keyLower = key.toLowerCase();
  const aliases = { arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', esc: 'escape', pageup: 'pageup', pagedown: 'pagedown' };
  if (aliases[keyLower]) return aliases[keyLower];
  
  const exactMatches = ['backspace', 'delete', 'enter', 'tab', 'escape', 'up', 'down', 'right', 'left', 'home', 'end', 'pageup', 'pagedown', 'space'];
  if (exactMatches.includes(keyLower)) return keyLower;

  if (keyLower === " " || keyLower === "spacebar") return "space";
  if (keyLower.length === 1 && keyLower.match(/[a-z0-9]/)) return keyLower;

  if (code && code.toLowerCase().startsWith('key')) return code[3].toLowerCase();
  if (code && code.toLowerCase().startsWith('digit')) return code[5];
  return null;
}
