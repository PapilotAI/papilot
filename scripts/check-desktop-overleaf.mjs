import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect } from './playwright.mjs';

// The desktop app's Overleaf sign-in: Overleaf's page opens in its own
// window, and once the project list opens the session's cookies come back;
// closing the window instead answers null. A local page stands in for
// Overleaf's login, and a minimal Electron app loads the compiled module.
// Run after npm run desktop:compile.
const require = createRequire(import.meta.url);
const server = http.createServer((request, response) => {
  if (request.url === '/login' && request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Log in</title><form method="post" action="/login"><button>Log in</button></form>'); return; }
  if (request.url === '/login' && request.method === 'POST') { response.writeHead(302, { Location: '/project', 'Set-Cookie': 'overleaf_session2=signed-in; Path=/; HttpOnly' }); response.end(); return; }
  if (request.url === '/project') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Projects</title>'); return; }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-overleaf-sign-in-'));
fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'papilot-overleaf-sign-in-check', type: 'module', main: 'main.js' }));
fs.writeFileSync(path.join(folder, 'main.js'), `import { app } from 'electron';
import { overleafSignIn } from ${JSON.stringify(pathToFileURL(path.resolve('.desktop/app/overleaf-sign-in.js')).href)};
app.setPath('userData', ${JSON.stringify(path.join(folder, 'data'))});
globalThis.overleafSignIn = overleafSignIn;
app.on('window-all-closed', () => {});
`);
const application = await electron.launch({ executablePath: require('electron'), args: [folder], timeout: 90000 });
try {
  await application.evaluate(({ app }) => app.whenReady());
  const opened = application.waitForEvent('window');
  const answer = application.evaluate((_electron, origin) => globalThis.overleafSignIn(origin), origin);
  const login = await opened;
  await expect(login).toHaveURL(`${origin}/login`);
  assert.doesNotMatch(await login.evaluate(() => navigator.userAgent), /Electron|Papilot/, 'Overleaf’s page sees a browser');
  assert.equal(await login.evaluate(() => typeof window.papilotDesktop), 'undefined', 'the sign-in page has no app bridge');
  await login.getByRole('button', { name: 'Log in' }).click();
  assert.equal(await answer, 'overleaf_session2=signed-in');
  await expect.poll(() => login.isClosed()).toBe(true);
  // A fresh window has a fresh session, and closing it answers null.
  const again = application.waitForEvent('window');
  const cancelled = application.evaluate((_electron, origin) => globalThis.overleafSignIn(origin), origin);
  const second = await again;
  await expect(second).toHaveURL(`${origin}/login`);
  await second.close();
  assert.equal(await cancelled, null);
  console.log('Desktop Overleaf sign-in checks passed.');
} finally {
  await application.close().catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(folder, { recursive: true, force: true });
}
