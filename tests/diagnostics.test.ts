import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics, parseDoctorReport } from '../src/server/diagnostics.ts';
import { diagnosticSummary } from '../src/web/diagnostic-report.ts';
import type { DiagnosticReport } from '../src/shared.ts';

const report: DiagnosticReport = {
  version: '0.6.0', ok: false, checkedAt: 1700000000000, platform: 'darwin', arch: 'arm64', node: '22.22.0',
  checks: [{ id: 'latexmk', ok: false, severity: 'error', detail: '/Users/private/paper/secret was not found.', fix: 'Fix /Users/private/bin' }],
};

test('diagnostics accept failed checks and reject missing or malformed reports', () => {
  assert.equal(parseDoctorReport(JSON.stringify(report)).checks[0].id, 'latexmk');
  for (const output of ['not JSON', '{}', JSON.stringify({ ...report, checks: [] }), JSON.stringify({ ...report, checks: [{ ok: false }] })]) assert.throws(() => parseDoctorReport(output));
});

test('concurrent checks share a probe; completed and failed checks can be retried', async () => {
  let calls = 0, fail = false;
  const service = new Diagnostics(async (repo, port) => {
    calls++;
    assert.equal(repo, '/paper'); assert.equal(port, 8123);
    await new Promise(resolve => setImmediate(resolve));
    if (fail) throw new Error('probe failed');
    return report;
  });
  const [first, second] = await Promise.all([service.check('/paper', 8123), service.check('/paper', 8123)]);
  assert.equal(calls, 1); assert.equal(first, second); assert.ok(first.checkedAt > report.checkedAt);
  fail = true;
  await assert.rejects(service.check('/paper', 8123), /probe failed/);
  fail = false;
  await service.check('/paper', 8123);
  assert.equal(calls, 3);
});

test('shared diagnostics include useful results without accounts, paths, tool errors or model names', () => {
  const text = diagnosticSummary(report, true, { codex: {
    connected: true, authenticated: true, account: 'private@example.com', error: 'token=secret', models: [{ id: 'private-model', name: 'Private model', isDefault: true, efforts: [], defaultEffort: null }],
  } });
  assert.doesNotMatch(text, /private|secret|token|\/Users\//i);
  const summary = JSON.parse(text);
  assert.equal(summary.agents.codex.models, 1);
  assert.equal(summary.agents.claude, null);
  assert.deepEqual(summary.checks, [{ id: 'latexmk', ok: false, severity: 'error' }]);
  assert.equal(summary.version, report.version);
});
