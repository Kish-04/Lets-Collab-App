const { contextBridge, ipcRenderer } = require('electron');

const backendArg = process.argv.find(arg => arg.startsWith('--letscollab-backend-url='));
const backendUrl = backendArg ? backendArg.slice('--letscollab-backend-url='.length) : null;

contextBridge.exposeInMainWorld('electronConfig', {
  backendUrl
});

contextBridge.exposeInMainWorld('__LETSCOLLAB_BACKEND_URL__', backendUrl);

const existingApi = window.api || {};
contextBridge.exposeInMainWorld('api', {
  ...existingApi,
  askGemini: (prompt, codeContext) => ipcRenderer.invoke('gemini:ask', prompt, codeContext),
  getPanicShortcuts: () => ipcRenderer.invoke('get-panic-shortcuts'),
  getShareableSources: () => ipcRenderer.invoke('get-shareable-sources'),
  setShareSource: (sourceId) => ipcRenderer.invoke('set-share-source', sourceId),
  oauthLogin: (provider) => ipcRenderer.invoke('oauth-login', provider),
});

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => {
    // Whitelist channels
    const validChannels = ['execute-input', 'set-remote-input-lock', 'set-clipboard-guard', 'toggle-fullscreen', 'pet-state-update', 'move-pet-window', 'start-drag', 'set-pet-enabled', 'set-ignore-mouse-events'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ['system-event', 'pet-sync-state', 'panic-revoke-control'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  getDeviceLogs: () => ipcRenderer.invoke('get-device-logs')
});
