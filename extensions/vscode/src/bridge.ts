import { OPEN_SOURCE, SELECT_PAPER, SHOW_SOURCE, SOURCE_READY, SOURCE_SAVED, HOST_READY, HOST_CAPABILITIES } from '../../../src/host-events.ts';

/** Installed only by this host. The app itself knows only the generic events. */
export function bridgeScript(token: string) {
  return `(() => {
    const token = ${JSON.stringify(token)};
    const send = (type, detail) => parent.postMessage({ channel: 'papilot', token, type, detail }, '*');
    window.addEventListener(${JSON.stringify(OPEN_SOURCE)}, event => {
      event.preventDefault(); send('open-source', event.detail);
    });
    window.addEventListener(${JSON.stringify(SOURCE_READY)}, event => send('source-ready', event.detail));
    window.addEventListener(${JSON.stringify(HOST_CAPABILITIES)}, event => { event.detail.source = true; });
    window.addEventListener(${JSON.stringify(HOST_READY)}, () => send('ready'));
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== parent || message?.channel !== 'papilot' || message.token !== token) return;
      const events = { select: ${JSON.stringify(SELECT_PAPER)}, show: ${JSON.stringify(SHOW_SOURCE)}, saved: ${JSON.stringify(SOURCE_SAVED)} };
      if (events[message.type]) window.dispatchEvent(new CustomEvent(events[message.type], { detail: message.detail }));
    });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const url = new URL(link.href, location.href);
      if (['https:', 'http:', 'mailto:'].includes(url.protocol) && url.origin !== location.origin) {
        event.preventDefault(); send('open-external', { url: url.href });
      }
    });
  })();`;
}

const attribute = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function panelHtml(url: string, token: string, nonce: string) {
  const origin = new URL(url).origin;
  return `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${attribute(origin)}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'">
    <style nonce="${nonce}">html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden}body{background:var(--vscode-editor-background)}</style>
    </head><body><iframe title="Papilot" allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups"></iframe>
    <script nonce="${nonce}">
      const host = acquireVsCodeApi(), frame = document.querySelector('iframe');
      const token = ${JSON.stringify(token)}, origin = ${JSON.stringify(origin)};
      window.addEventListener('message', event => {
        const message = event.data;
        if (event.source === frame.contentWindow) {
          if (event.origin === origin && message?.channel === 'papilot' && message.token === token && ['ready', 'source-ready', 'open-source', 'open-external'].includes(message.type)) host.postMessage(message);
        } else if (message?.channel === 'papilot' && message.token === token) {
          if (message.type === 'load') frame.src = ${JSON.stringify(url)};
          else frame.contentWindow.postMessage(message, origin);
        }
      });
      host.postMessage({ channel: 'papilot', token, type: 'frame-host', detail: { ancestors: [location.origin, ...Array.from(location.ancestorOrigins)] } });
    </script></body></html>`;
}
