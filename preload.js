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
    const validChannels = ['execute-input', 'set-remote-input-lock', 'set-clipboard-guard', 'toggle-fullscreen', 'pet-state-update', 'move-pet-window', 'set-pet-enabled', 'set-ignore-mouse-events', 'enable-kiosk-mode'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ['system-event', 'pet-sync-state', 'panic-revoke-control', 'anticheat-alert'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender`
      const listener = (event, ...args) => func(...args);
      ipcRenderer.on(channel, listener);
      // Callers can stop listening (e.g. when a supervised exam ends)
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  }
});
