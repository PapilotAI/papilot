import test from 'node:test';
import assert from 'node:assert/strict';
import { aptPublication, type AptPackageEntry } from '../scripts/publish-apt.mts';
import worker from '../site/worker.mjs';

test('APT publishing is idempotent and preserves the newest stable package', () => {
  const checksum = 'a'.repeat(64);
  const entry = (version: string, sha256 = checksum): AptPackageEntry => ({
    version,
    filename: `pool/main/p/papilot-desktop/Papilot-${version}-linux-amd64.deb`,
    size: 185_000_000,
    md5: '1'.repeat(32),
    sha1: '2'.repeat(40),
    sha256,
    sha512: '3'.repeat(128),
    control: `Package: papilot-desktop\nVersion: ${version}`,
  });

  assert.deepEqual(aptPublication([], '0.14.1', checksum), { state: 'publish' });
  assert.deepEqual(aptPublication([entry('0.14.0')], '0.14.1', checksum), { state: 'publish' });
  assert.deepEqual(aptPublication([entry('0.14.1')], '0.14.1', checksum), { state: 'current' });
  assert.deepEqual(aptPublication([entry('0.14.10')], '0.14.2', checksum), { state: 'older' });
  assert.throws(
    () => aptPublication([entry('0.14.1', 'b'.repeat(64))], '0.14.1', checksum),
    /different checksum/,
  );
});

test('site worker serves signed APT metadata and redirects verified deb paths to GitHub Releases', async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    return new Response(`proxied:${url}`, {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Content-Length': String(`proxied:${url}`.length) },
    });
  }) as typeof fetch;

  try {
    const deb = await worker.fetch(
      new Request('https://papilot.ai/apt/pool/main/p/papilot-desktop/Papilot-0.14.1-linux-amd64.deb'),
      {},
    );
    assert.equal(deb.status, 302);
    assert.equal(
      deb.headers.get('Location'),
      'https://github.com/PapilotAI/papilot/releases/download/v0.14.1/Papilot-0.14.1-linux-amd64.deb',
    );

    const key = await worker.fetch(new Request('https://papilot.ai/apt/gpg.key'), {});
    assert.equal(key.status, 200);
    assert.equal(await key.text(), 'proxied:https://papilotai.github.io/apt/gpg.key');
    assert.equal(key.headers.get('Cache-Control'), 'public, max-age=60');

    const byHash = await worker.fetch(
      new Request('https://papilot.ai/apt/dists/stable/main/binary-amd64/by-hash/SHA256/abcdef'),
      {},
    );
    assert.equal(byHash.status, 200);
    assert.equal(byHash.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');

    const head = await worker.fetch(new Request('https://papilot.ai/apt/dists/stable/InRelease', { method: 'HEAD' }), {});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const badDeb = await worker.fetch(
      new Request('https://papilot.ai/apt/pool/main/p/papilot-desktop/Papilot-0.14.1-dev-linux-amd64.deb'),
      {},
    );
    assert.equal(badDeb.status, 404);

    const traversal = await worker.fetch(new Request('https://papilot.ai/apt/dists/..%2Fsecret'), {});
    assert.equal(traversal.status, 404);

    const post = await worker.fetch(new Request('https://papilot.ai/apt/gpg.key', { method: 'POST' }), {});
    assert.equal(post.status, 405);
    assert.equal(fetched.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
