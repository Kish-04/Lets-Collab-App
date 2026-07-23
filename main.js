const { app, BrowserWindow, ipcMain, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

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
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  try { fs.writeFileSync(getLogPath('electron-rejection.log'), String(reason)); } catch(e){}
  process.exit(1);
});

let robot;
let clipboardGuardEnabled = false;
let screenCaptureActive = false;
let globalStream = null;

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

const express = require('express');
const uiServer = express();
let actualUiPort = process.env.UI_PORT || 0; // 0 will auto-assign a free port

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed.replace(/\/$/, '') : '';
}

function readJsonConfig(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`Could not read config file ${filePath}:`, err.message);
    return null;
  }
}

function getConfiguredBackendUrl() {
  const envUrl = normalizeUrl(
    process.env.LETSCOLLAB_BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL
  );
  if (envUrl) return envUrl;

  const configPaths = [
    path.join(__dirname, 'app-config.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app-config.json') : null,
  ];
  try {
    configPaths.push(path.join(app.getPath('userData'), 'app-config.json'));
  } catch (err) {
    // app.getPath may be unavailable very early in startup.
  }

  for (const configPath of configPaths) {
    const config = readJsonConfig(configPath);
    const backendUrl = normalizeUrl(config && (config.backendUrl || config.NEXT_PUBLIC_BACKEND_URL));
    if (backendUrl) return backendUrl;
  }

  return '';
}

// Log all requests to trace Next.js hydration issues
uiServer.use((req, res, next) => {
  const logMsg = `[EXPRESS] Received request: ${req.method} ${req.originalUrl}\n`;
  console.log(logMsg.trim());
  try { fs.appendFileSync(getLogPath('renderer-error.log'), logMsg); } catch(e) {}
  
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMsg2 = `[EXPRESS] Finished: ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)\n`;
    console.log(logMsg2.trim());
    try { fs.appendFileSync(getLogPath('renderer-error.log'), logMsg2); } catch(e) {}
  });
  next();
});

uiServer.use(express.static(path.join(__dirname, 'out'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

uiServer.get('/app-config.json', (req, res) => {
  res.json({ backendUrl: getConfiguredBackendUrl() || null });
});

uiServer.get('/', (req, res) => res.sendFile(path.join(__dirname, 'out', 'index.html')));
uiServer.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'out', 'app.html')));
uiServer.get('/session', (req, res) => res.sendFile(path.join(__dirname, 'out', 'session.html')));
uiServer.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'out', 'login.html')));
uiServer.get('/history', (req, res) => res.sendFile(path.join(__dirname, 'out', 'history.html')));
uiServer.get('/recent', (req, res) => res.sendFile(path.join(__dirname, 'out', 'recent.html')));
uiServer.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin.html')));
uiServer.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'login.html')));
uiServer.get('/admin/alerts', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'alerts.html')));
uiServer.get('/admin/blockchain', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'blockchain.html')));
uiServer.get('/admin/users', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'users.html')));
uiServer.get('/admin/reports', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'reports.html')));
uiServer.get('/admin/sessions', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin', 'sessions.html')));

// We won't listen here anymore, we'll listen inside app.whenReady()

try {
  robot = require('robotjs');
  // Configure robotjs
  robot.setMouseDelay(0);
} catch (e) {
  console.warn("Could not load robotjs plugin.", e.message);
}

function createWindow() {
  const backendUrl = getConfiguredBackendUrl();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendUrl ? [`--letscollab-backend-url=${backendUrl}`] : []
    }
  });

  // Load the Next.js app with a retry mechanism to handle the server startup race condition
  const loadWithRetry = (url, retries = 5, delay = 1000) => {
    win.webContents.session.clearCache().then(() => {
      win.loadURL(url).catch((err) => {
        if (retries > 0) {
          console.log(`Failed to load ${url}, retrying in ${delay}ms... (${retries} retries left)`);
          setTimeout(() => loadWithRetry(url, retries - 1, delay), delay);
        } else {
          const { dialog } = require('electron');
          dialog.showErrorBox('Connection Error', `Failed to connect to the Let's Collab backend server after multiple attempts.\n\nError: ${err.message}`);
          app.quit();
        }
      });
    });
  };

  loadWithRetry(process.env.APP_URL || `http://127.0.0.1:${actualUiPort}/app`);

  // Forward renderer console logs to main process terminal and a file
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE] level ${level}: ${message} (${sourceId}:${line})`);
    try { fs.appendFileSync(getLogPath('renderer-error.log'), `[RENDERER] ${message}\n`); } catch(e) {}
  });

  // --- PERMISSION HANDLERS (Required for WebRTC Camera/Mic/Screen in Electron) ---
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'display-capture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      console.log(`Denied permission request for: ${permission}`);
      callback(false);
    }
  });

  win.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'display-capture'];
    if (allowedPermissions.includes(permission)) {
      return true;
    }
    return false;
  });

  // Handle getDisplayMedia requests for screen sharing
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      // Automatically share the primary screen (first source)
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback();
      }
    }).catch(err => {
      console.error('Error getting display media sources:', err);
      callback();
    });
  });
  
  // --- SYSTEM LEVEL ANTI-CHEAT ---
  // 1. Detect Window Blur (Alt-Tab / Switching focus)
  win.on('blur', () => {
    win.webContents.send('system-event', {
      type: 'BLUR_EVENT',
      message: 'User switched away from the collaboration window'
    });
  });

  // 2. Detect Clipboard Changes (Copy / Paste)
  let previousClipboardText = clipboard.readText();
  setInterval(() => {
    const currentText = clipboard.readText();
    // Only flag if the text changed and isn't empty (user copied something new)
    if (currentText !== previousClipboardText && currentText.trim().length > 0) {
      previousClipboardText = currentText;
      
      // Optionally restrict length of logged text to avoid huge payloads
      const snippet = currentText.length > 50 ? currentText.substring(0, 50) + '...' : currentText;
      
      win.webContents.send('system-event', {
        type: 'CLIPBOARD_CHANGE',
        message: `Clipboard activity detected: "${snippet}"`
      });
      if (clipboardGuardEnabled) {
        clipboard.clear();
        previousClipboardText = '';
      }
    }
  }, 1000); // Check every second

  // Open the DevTools automatically for debugging
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  try { fs.writeFileSync(getLogPath('electron-debug.log'), 'App is ready! Starting Express server...\n'); } catch(e) {}
  
  const server = uiServer.listen(actualUiPort, () => {
    actualUiPort = server.address().port;
    console.log(`Let's Collab! UI server running on port ${actualUiPort}`);
    createWindow();
  });

  server.on('error', (e) => {
    try { fs.writeFileSync(getLogPath('electron-error.log'), 'Express Error: ' + e.message); } catch(err){}
    process.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC HANDLERS FOR REMOTE INPUT ---
ipcMain.on('execute-input', (event, payload) => {
  if (payload.type === 'gamepad-state') {
    if (virtualGamepad) {
      try {
        // payload expects axes and buttons arrays
        // Axes: LeftX, LeftY, RightX, RightY (range -1 to 1)
        if (payload.axes && payload.axes.length >= 4) {
          virtualGamepad.axis.leftX.setValue(payload.axes[0]);
          virtualGamepad.axis.leftY.setValue(-payload.axes[1]); // Invert Y
          virtualGamepad.axis.rightX.setValue(payload.axes[2]);
          virtualGamepad.axis.rightY.setValue(-payload.axes[3]);
        }
        
        // Buttons (0-16 for X360 standard)
        if (payload.buttons && payload.buttons.length >= 17) {
          virtualGamepad.button.A.setValue(payload.buttons[0].pressed);
          virtualGamepad.button.B.setValue(payload.buttons[1].pressed);
          virtualGamepad.button.X.setValue(payload.buttons[2].pressed);
          virtualGamepad.button.Y.setValue(payload.buttons[3].pressed);
          
          virtualGamepad.button.LEFT_SHOULDER.setValue(payload.buttons[4].pressed);
          virtualGamepad.button.RIGHT_SHOULDER.setValue(payload.buttons[5].pressed);
          
          virtualGamepad.axis.leftTrigger.setValue(payload.buttons[6].value); // LT analog
          virtualGamepad.axis.rightTrigger.setValue(payload.buttons[7].value); // RT analog
          
          virtualGamepad.button.BACK.setValue(payload.buttons[8].pressed);
          virtualGamepad.button.START.setValue(payload.buttons[9].pressed);
          
          virtualGamepad.button.LEFT_THUMB.setValue(payload.buttons[10].pressed);
          virtualGamepad.button.RIGHT_THUMB.setValue(payload.buttons[11].pressed);
          
          virtualGamepad.button.D_UP.setValue(payload.buttons[12].pressed);
          virtualGamepad.button.D_DOWN.setValue(payload.buttons[13].pressed);
          virtualGamepad.button.D_LEFT.setValue(payload.buttons[14].pressed);
          virtualGamepad.button.D_RIGHT.setValue(payload.buttons[15].pressed);
          
          virtualGamepad.button.GUIDE.setValue(payload.buttons[16].pressed);
        }
      } catch (err) {
        console.error('Error updating virtual gamepad:', err.message);
      }
    } else {
      console.log('[MOCK GAMEPAD EXECUTING]', payload);
    }
    return;
  }

  // If robotjs isn't installed (e.g. build failure), just log it
  if (!robot) {
    console.log('[MOCK ROBOTJS EXECUTING]', payload);
    return;
  }

  try {
    const screenSize = robot.getScreenSize();
    
    // We expect payload.x and payload.y to be percentages (0.0 to 1.0)
    // based on the client's position over the video feed.
    const realX = Math.round(payload.x * screenSize.width);
    const realY = Math.round(payload.y * screenSize.height);

    switch (payload.type) {
      case 'mousemove':
        robot.moveMouse(realX, realY);
        break;
      
      case 'mousedown':
        robot.mouseToggle("down", payload.button === 2 ? "right" : "left");
        break;
        
      case 'mouseup':
        robot.mouseToggle("up", payload.button === 2 ? "right" : "left");
        break;
        
      case 'wheel':
        // Delta > 0 typically means scroll down, < 0 means scroll up
        robot.scrollMouse(0, payload.deltaY > 0 ? -1 : 1);
        break;

      case 'keydown':
        if (payload.key) {
           const mappedKey = mapBrowserKeyToRobotJS(payload.key, payload.code);
           if (mappedKey) {
             const modifiers = mapModifiers(payload.modifiers);
             robot.keyToggle(mappedKey, 'down', modifiers);
           }
        }
        break;

      case 'keyup':
        if (payload.key) {
           const mappedKey = mapBrowserKeyToRobotJS(payload.key, payload.code);
           if (mappedKey) {
             const modifiers = mapModifiers(payload.modifiers);
             robot.keyToggle(mappedKey, 'up', modifiers);
           }
        }
        break;
    }
  } catch (err) {
    console.error('Error executing robot js command:', err.message);
  }
});

ipcMain.on('set-clipboard-guard', (event, locked) => {
  clipboardGuardEnabled = Boolean(locked);
  if (clipboardGuardEnabled) clipboard.clear();
});

// Helper variables for basic mapping
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

  const aliases = {
    arrowup: 'up',
    arrowdown: 'down',
    arrowleft: 'left',
    arrowright: 'right',
    esc: 'escape',
    pageup: 'pageup',
    pagedown: 'pagedown',
  };

  if (aliases[keyLower]) return aliases[keyLower];
  
  const exactMatches = [
    'backspace', 'delete', 'enter', 'tab', 'escape', 'up', 'down', 'right', 'left', 'home', 'end', 'pageup', 'pagedown', 'space'
  ];

  if (exactMatches.includes(keyLower)) return keyLower;

  // Handle spaces
  if (keyLower === " " || keyLower === "spacebar") return "space";

  // Handle characters 
  if (keyLower.length === 1 && keyLower.match(/[a-z0-9]/)) { return keyLower; }

  // Fallbacks based on code
  if (code && code.toLowerCase().startsWith('key')) return code[3].toLowerCase();
  if (code && code.toLowerCase().startsWith('digit')) return code[5];

  return null;
}
