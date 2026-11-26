import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { findWindowsInstaller, stageWindowsInstaller } from '../src/server/windows-installer.ts';

const version = '0.7.0';
const tag = `v${version}`;
const name = `Papilot-${version}-win-x64.exe`;
const metadataUrl = `https://api.github.com/repos/PapilotAI/papilot/releases/tags/${tag}`;
const installerUrl = `https://github.com/PapilotAI/papilot/releases/download/${tag}/${name}`;
const chunks = [Buffer.from('first chunk'), Buffer.from(' second chunk')];
const bytes = Buffer.concat(chunks);
const target = { version, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const asset = { name, size: target.size, browser_download_url: installerUrl, digest: `sha256:${target.sha256}` };
const release = { tag_name: tag, draft: false, prerelease: false, assets: [asset] };

const metadata = (value: unknown): typeof fetch => async input => {
  assert.equal(String(input), metadataUrl);
  return Response.json(value);
};
const download = (body: Uint8Array[]): typeof fetch => async input => {
  assert.equal(String(input), installerUrl);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of body) controller.enqueue(chunk);
      controller.close();
    },
  }));
};
const temporary = (t: TestContext) => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-windows-installer-'));
  t.after(() => fs.rmSync(data, { force: true, recursive: true }));
  return data;
};
const files = (data: string) => fs.readdirSync(data, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name));

test('Windows installer discovery uses exact stable GitHub release metadata', async () => {
  const portable = { ...asset, name: `Papilot-${version}-win-x64-portable.exe` };
  assert.deepEqual(await findWindowsInstaller(version, metadata({ ...release, assets: [portable, asset] })), target);
  for (const untrusted of [
    { ...release, tag_name: 'v0.7.1' },
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, assets: [portable] },
    { ...release, assets: [asset, asset] },
    ...[
      { browser_download_url: `https://example.com/${name}` },
      { browser_download_url: installerUrl.replace(tag, 'v0.7.1') },
      { size: 0 }, { size: 2 ** 30 + 1 }, { size: 1.5 },
      { digest: undefined }, { digest: 'sha256:bad' },
    ].map(fields => ({ ...release, assets: [{ ...asset, ...fields }] })),
  ]) assert.equal(await findWindowsInstaller(version, metadata(untrusted)), null);
  assert.equal(await findWindowsInstaller(version, async () => new Response(null, { status: 403 })), null);
  let requests = 0;
  assert.equal(await findWindowsInstaller('../0.7.0', async () => { requests++; return Response.json(release); }), null);
  assert.equal(requests, 0);
});

test('Windows installer staging saves the verified bytes from the official asset', async t => {
  const data = temporary(t);
  await stageWindowsInstaller(data, target, download(chunks));
  const staged = path.join(data, 'updates', 'desktop', 'installer', name);
  assert.deepEqual(files(data), [staged]);
  assert.deepEqual(fs.readFileSync(staged), bytes);
});

test('Windows installer staging removes partial and unverified downloads', async t => {
  const interrupted: typeof fetch = async () => {
    let sent = false;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new Error('Connection dropped'));
        else { sent = true; controller.enqueue(chunks[0]); }
      },
    }));
  };
  const changed = Buffer.from(chunks[0]); changed[0] ^= 1;
  for (const fetcher of [download([changed, chunks[1]]), download([chunks[0]]), download([...chunks, Buffer.from('extra')]), interrupted]) {
    const data = temporary(t);
    await assert.rejects(stageWindowsInstaller(data, target, fetcher));
    assert.deepEqual(files(data), []);
  }
});
