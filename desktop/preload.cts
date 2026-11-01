import { contextBridge, ipcRenderer } from 'electron';

// Only window actions cross the sandbox boundary. No generic IPC, filesystem,
// shell or agent capabilities are exposed to the renderer.
contextBridge.exposeInMainWorld('papilotDesktop', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('papilot:window', 'minimize'),
  maximize: () => ipcRenderer.send('papilot:window', 'maximize'),
  close: () => ipcRenderer.send('papilot:window', 'close'),
});
