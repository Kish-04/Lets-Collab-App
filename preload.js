const { contextBridge, ipcRenderer } = require('electron');

const backendArg = process.argv.find(arg => arg.startsWith('--letscollab-backend-url='));
const backendUrl = backendArg ? backendArg.slice('--letscollab-backend-url='.length) : null;

contextBridge.exposeInMainWorld('electronConfig', {
  backendUrl
});

contextBridge.exposeInMainWorld('ipcRenderer', {
  send: (channel, data) => {
    // Whitelist channels
    const validChannels = ['execute-input', 'set-clipboard-guard', 'toggle-fullscreen'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = ['system-event'];
    if (validChannels.includes(channel)) {
      // Deliberately strip event as it includes `sender` 
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  getDeviceLogs: () => ipcRenderer.invoke('get-device-logs')
});
