import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';

// The sandboxed preload cannot import the workspace's appearance module.
// Keep these in step with INTERFACE_SIZES in src/web/appearance.ts.
const interfaceSizes = [1, 1.1, 1.25, 1.5, 1.75, 2];
const setZoom = (factor: unknown) => {
  if (typeof factor === 'number' && interfaceSizes.includes(factor)) webFrame.setZoomFactor(factor);
};

// The main process passes the desktop's window button layout (Linux) as an
// argument; see window-buttons.ts.
const windowButtonsArgument = '--papilot-window-buttons=';
let windowButtons: unknown;
try {
  const value = process.argv.find(arg => arg.startsWith(windowButtonsArgument));
  if (value) windowButtons = JSON.parse(value.slice(windowButtonsArgument.length));
} catch { /* the page keeps its default layout */ }

// Expose specific window and user-selected folder actions, not generic IPC or
// filesystem access. Papers open in place; their files stay on disk.
contextBridge.exposeInMainWorld('papilotDesktop', {
  platform: process.platform,
  windowButtons,
  typelessStatus: () => ipcRenderer.invoke('papilot:typeless-status'),
  typelessShortcut: (inputId: string) => ipcRenderer.invoke('papilot:typeless-shortcut', inputId),
  minimize: () => ipcRenderer.send('papilot:window', 'minimize'),
  maximize: () => ipcRenderer.send('papilot:window', 'maximize'),
  close: () => ipcRenderer.send('papilot:window', 'close'),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('papilot:choose-directory'),
  // Overleaf's sign-in page in its own window; resolves with the session's
  // cookies, or null when the author closes it.
  overleafSignIn: (origin: string): Promise<string | null> => ipcRenderer.invoke('papilot:overleaf-sign-in', origin),
  openEnvironment: () => ipcRenderer.invoke('papilot:open-environment'),
  environment: (): Promise<string> => ipcRenderer.invoke('papilot:current-environment'),
  notify: (alert: { taskId: string | null; title: string; body: string; sound: boolean }): Promise<boolean> => ipcRenderer.invoke('papilot:notify', alert),
  onOpenTask: (listener: (taskId: string) => void) => {
    const receive = (_event: IpcRendererEvent, taskId: unknown) => { if (typeof taskId === 'string') listener(taskId); };
    ipcRenderer.on('papilot:open-task', receive);
    return () => { ipcRenderer.off('papilot:open-task', receive); };
  },
  // A papilot://new link from the Universe website waits in the main process
  // until the page takes it, so a link that launched the app is not lost.
  takeNewPaper: (): Promise<{ id: string; version: string } | null> => ipcRenderer.invoke('papilot:take-new-paper'),
  onNewPaper: (listener: () => void) => {
    const receive = () => listener();
    ipcRenderer.on('papilot:new-paper', receive);
    return () => { ipcRenderer.off('papilot:new-paper', receive); };
  },
  onOpenSettings: (listener: () => void) => {
    const receive = () => listener();
    ipcRenderer.on('papilot:open-settings', receive);
    return () => { ipcRenderer.off('papilot:open-settings', receive); };
  },
  // Settings › Appearance › Interface size zooms this window; the View menu's
  // zoom items ask the page to step that saved size.
  setZoom,
  onZoom: (listener: (direction: 'in' | 'out' | 'reset') => void) => {
    const receive = (_event: IpcRendererEvent, direction: unknown) => { if (direction === 'in' || direction === 'out' || direction === 'reset') listener(direction); };
    ipcRenderer.on('papilot:zoom', receive);
    return () => { ipcRenderer.off('papilot:zoom', receive); };
  },
  // File › Open Paper… picks the folder in the main process and sends its path.
  onOpenFolder: (listener: (folder: string) => void) => {
    const receive = (_event: IpcRendererEvent, folder: unknown) => { if (typeof folder === 'string') listener(folder); };
    ipcRenderer.on('papilot:open-folder', receive);
    return () => { ipcRenderer.off('papilot:open-folder', receive); };
  },
});

// Apply the saved interface size before the page first paints, so the window
// does not open at 100% and then jump. The page keeps it in sync afterwards.
try {
  setZoom(JSON.parse(localStorage.getItem('papilot:appearance') || '{}')?.size);
} catch { /* storage unavailable or malformed: the page applies its default */ }

// Every handler validates the local chooser window separately from app pages.
contextBridge.exposeInMainWorld('papilotEnvironment', {
  info: () => ipcRenderer.invoke('papilot:environment:info'),
  inspect: (value: unknown) => ipcRenderer.invoke('papilot:environment:inspect', value),
  copyInstall: () => ipcRenderer.invoke('papilot:environment:copyInstall'),
  prepare: (distribution: string) => ipcRenderer.invoke('papilot:environment:prepare', distribution),
  cancel: () => ipcRenderer.invoke('papilot:environment:cancel'),
  apply: (value: unknown) => ipcRenderer.invoke('papilot:environment:apply', value),
  help: (key?: string) => ipcRenderer.invoke('papilot:environment:help', key),
  onProgress: (listener: (text: string) => void) => {
    const receive = (_event: IpcRendererEvent, text: unknown) => { if (typeof text === 'string') listener(text); };
    ipcRenderer.on('papilot:environment:progress', receive);
    return () => ipcRenderer.off('papilot:environment:progress', receive);
  },
});
