// Older Electron releases do not expose their out-of-process webviews as
// Playwright frames. Inspect the Chromium targets for visible webviews.
export async function connectWebviews(port, page) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(webSocketDebuggerUrl), pending = new Map();
  let next = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const { id, result, error } = JSON.parse(event.data);
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (error) request.reject(new Error(error.message)); else request.resolve(result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('VS Code closed its debugger.'));
    pending.clear();
  });
  function send(method, params, sessionId) {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('VS Code closed its debugger.');
      const id = ++next;
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      pending.set(id, { resolve, reject });
    });
  }
  async function evaluate(targetId, check, value = null) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression: `(() => {
          const view = document.querySelector('#active-frame')?.contentDocument;
          return view?.querySelector('#root') ? (${check})(view, ${JSON.stringify(value)}) : null;
        })()`,
        returnByValue: true,
      }, sessionId);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
      return result.value;
    } finally {
      await send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
    }
  }
  return {
    async find(check) {
      const visible = new Set(await page.locator('iframe.webview:visible').evaluateAll(frames => frames.map(frame => frame.src)));
      const { targetInfos } = await send('Target.getTargets');
      for (const { targetId, url, type } of targetInfos) {
        if (type === 'iframe' && visible.has(url) && await evaluate(targetId, check)) return (run, value) => evaluate(targetId, run, value);
      }
    },
    close() { socket.close(); },
  };
}
