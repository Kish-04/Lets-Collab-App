const { app, BrowserWindow, ipcMain, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  fs.writeFileSync('C:/Users/LENOVO/AppData/Local/Temp/electron-error.log', err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  fs.writeFileSync('C:/Users/LENOVO/AppData/Local/Temp/electron-rejection.log', String(reason));
  process.exit(1);
});

let robot;
let clipboardGuardEnabled = false;
let screenCaptureActive = false;
let globalStream = null;

const express = require('express');
const uiServer = express();
const uiPort = process.env.UI_PORT || 3000;

// Log all requests to trace Next.js hydration issues
uiServer.use((req, res, next) => {
  const logMsg = `[EXPRESS] Received request: ${req.method} ${req.originalUrl}\n`;
  console.log(logMsg.trim());
  try {
    fs.appendFileSync(path.join(__dirname, 'renderer-error.log'), logMsg);
  } catch(e) {}
  
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMsg2 = `[EXPRESS] Finished: ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)\n`;
    console.log(logMsg2.trim());
    try {
      fs.appendFileSync(path.join(__dirname, 'renderer-error.log'), logMsg2);
    } catch(e) {}
  });
  next();
});

uiServer.use(express.static(path.join(__dirname, 'out'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

uiServer.get('/', (req, res) => res.sendFile(path.join(__dirname, 'out', 'index.html')));
uiServer.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'out', 'app.html')));
uiServer.get('/session', (req, res) => res.sendFile(path.join(__dirname, 'out', 'session.html')));
uiServer.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'out', 'login.html')));
uiServer.get('/history', (req, res) => res.sendFile(path.join(__dirname, 'out', 'history.html')));
uiServer.get('/recent', (req, res) => res.sendFile(path.join(__dirname, 'out', 'recent.html')));
uiServer.use('/admin', (req, res) => res.sendFile(path.join(__dirname, 'out', 'admin.html')));

uiServer.listen(uiPort, () => {
  console.log(`Let's Collab! UI server running on port ${uiPort}`);
});

try {
  robot = require('robotjs');
  // Configure robotjs
  robot.setMouseDelay(0);
} catch (e) {
  console.warn("Could not load robotjs plugin.", e.message);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
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

  loadWithRetry(process.env.APP_URL || `http://127.0.0.1:${uiPort}/app`);

  // Forward renderer console logs to main process terminal and a file
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[RENDERER CONSOLE] level ${level}: ${message} (${sourceId}:${line})`);
    fs.appendFileSync(path.join(__dirname, 'renderer-error.log'), `[RENDERER] ${message}\n`);
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
        callback({ video: sources[0] });
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
  fs.writeFileSync('C:/Users/LENOVO/AppData/Local/Temp/electron-debug.log', 'App is ready! Creating window...\n');
  createWindow();

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
