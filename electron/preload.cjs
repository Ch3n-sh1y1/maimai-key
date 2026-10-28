const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maimai', {
  platform: process.platform,
  readContent: (relativePath) => ipcRenderer.invoke('content:read', relativePath),
  saveGenerated: (payload) => ipcRenderer.invoke('content:save-generated', payload),
  openContentFolder: () => ipcRenderer.invoke('content:open-folder'),
  userRoot: () => ipcRenderer.invoke('content:user-root'),
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  setFullscreen: (value) => ipcRenderer.invoke('window:set-fullscreen', Boolean(value)),
  logError: (message) => ipcRenderer.send('app:log-error', String(message)),
  onFullscreenChange: (callback) => {
    const handler = (_event, value) => callback(Boolean(value));
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },
});
