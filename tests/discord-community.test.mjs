import test from 'node:test';
import assert from 'node:assert/strict';
import { runNotice, weeklyDigest, sendWebhook } from '../scripts/discord-community.mjs';

const run = { id: 42, name: 'CI', head_branch: 'main', head_sha: 'abcdef123', repository: { full_name: 'PapilotAI/papilot' }, head_repository: { full_name: 'PapilotAI/papilot' }, event: 'push', conclusion: 'failure', run_attempt: 1, display_title: 'Fix @everyone <@123>' };
test('development alerts exclude forks, PRs, normal success and cancelled runs', () => {
  assert.equal(runNotice({ ...run, event: 'pull_request' }), null);
  assert.equal(runNotice({ ...run, head_repository: { full_name: 'someone/papilot' } }), null);
  assert.equal(runNotice({ ...run, head_branch: 'feature' }), null);
  assert.equal(runNotice({ ...run, conclusion: 'success' }), null);
  assert.equal(runNotice({ ...run, conclusion: 'cancelled' }), null);
  assert.match(runNotice(run).embeds[0].title, /Failed/);
  assert.match(runNotice({ ...run, conclusion: 'success' }, run).embeds[0].title, /Recovered/);
  assert.ok(runNotice({ ...run, name: 'Release', head_branch: 'v1.0.0' }));
  assert.deepEqual(runNotice(run).allowed_mentions, { parse: [] });
  assert.ok(!runNotice(run).embeds[0].description.includes('@'));
});
test('digest separates issues from PRs, highlights triage and stale issues, and fits Discord limits', () => {
  const issue = { number: 1, state: 'open', title: '@everyone [click](https://bad.test)', labels: [{ name: 'needs-triage' }, { name: 'bug' }], updated_at: '2026-10-01' };
  const message = weeklyDigest([issue, { ...issue, number: 2, pull_request: {} }], new Date('2026-11-15'));
  assert.match(message.embeds[0].description, /^1 open issues/);
  assert.ok(message.embeds[0].fields[0].value.includes('/issues/1'));
  assert.ok(!message.embeds[0].fields[0].value.includes('@everyone'));
  assert.ok(message.embeds[0].fields[2].value.includes('/issues/1'));
  const many = weeklyDigest(Array.from({ length: 200 }, (_, i) => ({ ...issue, number: i, title: 'x'.repeat(1000) })));
  assert.ok(many.embeds[0].fields.every(field => field.value.length <= 1024));
  assert.ok(JSON.stringify(many).length < 6000);
});
test('webhook enforces Discord destination, waits for delivery, retries rate limits and hides credentials', async () => {
  let count = 0;
  await sendWebhook('https://discord.com/api/webhooks/123/secret', {}, async url => {
    assert.equal(url.searchParams.get('wait'), 'true');
    return ++count === 1 ? { status: 429, ok: false, json: async () => ({ retry_after: 0.01 }) } : { ok: true };
  }, async () => {});
  assert.equal(count, 2);
  await assert.rejects(sendWebhook('https://evil.test/api/webhooks/123/secret', {}), /Expected a Discord/);
  await assert.rejects(sendWebhook('https://discord.com/api/webhooks/123/secret', {}, async () => { throw new Error('secret'); }), error => !error.message.includes('secret'));
});
