import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';

// Signing in to Overleaf happens on Overleaf's own page, in a window with a
// session of its own that is discarded afterwards, so Google and
// institutional logins work as in a browser and Papilot never sees the
// password. Once the project list opens, the session's cookies go to the
// Papilot server, which keeps them to sync papers.
let open: { window: BrowserWindow; done: (cookies: string | null) => void } | null = null;

export function overleafSignIn(origin: string, parent?: BrowserWindow): Promise<string | null> {
  const server = new URL(origin);
  if (!['https:', 'http:'].includes(server.protocol)) return Promise.resolve(null);
  open?.window.close();
  return new Promise(resolve => {
    const window = new BrowserWindow({ parent, width: 520, height: 760, minWidth: 420, minHeight: 560, title: 'Overleaf', autoHideMenuBar: true,
      webPreferences: { partition: `overleaf-sign-in-${randomUUID()}`, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    let settled = false;
    const done = (cookies: string | null) => {
      if (settled) return;
      settled = true; open = null; resolve(cookies);
      if (!window.isDestroyed()) window.close();
    };
    open = { window, done };
    // Google refuses sign-ins from pages that say they are an app.
    window.webContents.setUserAgent(app.userAgentFallback.replace(/\s(?:Electron|Papilot|papilot)\/\S+/g, ''));
    // A login provider's pop-up opens in this window instead.
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void window.loadURL(url); return { action: 'deny' }; });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const check = async (url: string) => {
      let page: URL;
      try { page = new URL(url); } catch { return; }
      if (page.origin !== server.origin || !/^\/project\/?$/.test(page.pathname)) return;
      const cookies = await window.webContents.session.cookies.get({ url: server.origin });
      if (cookies.length) done(cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
    };
    window.webContents.on('did-navigate', (_event, url) => void check(url));
    window.webContents.on('did-navigate-in-page', (_event, url) => void check(url));
    // The session lives only in memory and goes with the window.
    window.on('closed', () => done(null));
    void window.loadURL(new URL('/login', server).href).catch(() => done(null));
  });
}
