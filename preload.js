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
  askGemini: (prompt) => ipcRenderer.invoke('gemini:ask', prompt),
  getShareableSources: () => ipcRenderer.invoke('get-shareable-sources'),
  setShareSource: (sourceId) => ipcRenderer.invoke('set-share-source', sourceId),
});

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => {
    // Whitelist channels
    const validChannels = ['execute-input', 'set-clipboard-guard', 'toggle-fullscreen', 'pet-state-update', 'move-pet-window', 'start-drag', 'set-pet-enabled', 'set-ignore-mouse-events'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ['system-event', 'pet-sync-state'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  getDeviceLogs: () => ipcRenderer.invoke('get-device-logs')
});
