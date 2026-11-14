// Community automation runs only from the default branch, without PR code or artifacts.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const failed = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);
const repo = 'PapilotAI/papilot';
const root = `https://github.com/${repo}`;
const safe = (value, max = 180) => String(value ?? '').replace(/[@<>\[\]`*_~\\]/g, '').slice(0, max);
const envelope = embed => ({ username: 'Papilot Dev', allowed_mentions: { parse: [] }, embeds: [embed] });

export function runNotice(run, previous) {
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo || run.event === 'pull_request') return null;
  if (run.name !== 'Release' && run.head_branch !== 'main') return null;
  const recovery = run.conclusion === 'success' && failed.has(previous?.conclusion);
  if (!failed.has(run.conclusion) && !recovery) return null;
  return envelope({
    title: `${recovery ? 'Recovered / 已恢复' : 'Failed / 需要处理'}: ${safe(run.name, 100)}`,
    url: `${root}/actions/runs/${run.id}`,
    color: recovery ? 0x22c55e : 0xef4444,
    description: `${safe(run.head_branch)} · \`${safe(run.head_sha, 7)}\` · attempt ${run.run_attempt}\n${safe(run.display_title, 350)}`,
    footer: { text: 'Papilot development • Open the run for logs and rerun controls' },
  });
}

export function weeklyDigest(issues, now = new Date()) {
  const open = issues.filter(item => !item.pull_request && item.state === 'open');
  const needsTriage = open.filter(item => item.labels.some(label => label.name === 'needs-triage'));
  const bugs = open.filter(item => item.labels.some(label => label.name === 'bug'));
  const stale = open.filter(item => now - new Date(item.updated_at) >= 14 * 86400000);
  const list = values => values.slice(0, 5).map(item => `[#${item.number}](${root}/issues/${item.number}) ${safe(item.title, 95)}`).join('\n') || 'None / 暂无';
  return envelope({
    title: 'Weekly feedback triage / 每周反馈整理', url: `${root}/issues`, color: 0x6366f1,
    description: `${open.length} open issues · ${needsTriage.length} awaiting triage · ${bugs.length} bugs\nGitHub issue summary. Review Discord help/feedback forums separately.\n汇总 GitHub Issue；请同时查看 Discord 中尚未转成 Issue 的论坛帖。`,
    fields: [
      { name: 'Needs triage / 待分诊', value: list(needsTriage) },
      { name: 'Open bugs / 未解决问题', value: list(bugs) },
      { name: 'No update for 14+ days / 超过两周未更新', value: list(stale) },
      { name: 'Review queue / 待审 PR', value: `[Open pull requests](${root}/pulls) · [Help forum](https://discord.com/channels/1568215729063329955/1568217164996018226) · [Feedback forum](https://discord.com/channels/1568215729063329955/1568217316234100827)` },
    ],
    footer: { text: 'Triage → reproduce / clarify → link issue → implement → reply to the original post' },
  });
}

export async function sendWebhook(url, payload, request = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const target = new URL(url);
  if (target.origin !== 'https://discord.com' || !/^\/api\/webhooks\/\d+\/[^/]+$/.test(target.pathname)) throw new Error('Expected a Discord webhook URL');
  target.search = '?wait=true';
  for (let attempt = 0; attempt < 4; attempt++) {
    // Do not echo the URL, response body or fetch exception: they can contain the secret.
    let response;
    try { response = await request(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new Error('Discord request failed; check network access and webhook configuration'); }
    if (response.ok) return;
    if (response.status === 429 && attempt < 3) {
      const body = await response.json();
      await pause(Math.min(30000, Math.max(1000, Number(body.retry_after || 1) * 1000)));
      continue;
    }
    throw new Error(`Discord returned HTTP ${response.status}`);
  }
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

export async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let payload;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    const run = event.workflow_run;
    let previous;
    if (run.conclusion === 'success') {
      if (run.run_attempt > 1) {
        previous = await github(`actions/runs/${run.id}/attempts/${run.run_attempt - 1}`);
      } else {
        const runs = await github(`actions/workflows/${run.workflow_id}/runs?branch=${encodeURIComponent(run.head_branch)}&status=completed&per_page=30`);
        previous = runs.workflow_runs.filter(item => item.run_number < run.run_number && item.event === run.event && item.conclusion !== 'cancelled').sort((a, b) => b.run_number - a.run_number)[0];
      }
    }
    payload = runNotice(run, previous);
  } else if (process.env.GITHUB_EVENT_NAME === 'schedule' || event.inputs?.mode === 'digest') {
    const issues = [];
    for (let page = 1; ; page++) {
      const batch = await github(`issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`);
      issues.push(...batch);
      if (batch.length < 100) break;
    }
    payload = weeklyDigest(issues);
  } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    payload = envelope({ title: 'Papilot community automation connected / 社区自动化已连接', color: 0x22c55e,
      description: 'Development failure/recovery alerts and the weekly GitHub feedback digest are configured.\n开发失败与恢复通知、每周 GitHub 反馈摘要已配置。', url: `${root}/actions` });
  }
  if (!payload) { console.log('No notification needed.'); return; }
  if (!process.env.DISCORD_DEV_WEBHOOK_URL) throw new Error('DISCORD_DEV_WEBHOOK_URL is not configured');
  await sendWebhook(process.env.DISCORD_DEV_WEBHOOK_URL, payload);
  console.log('Discord notification delivered.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
