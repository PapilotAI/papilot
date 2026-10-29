import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { chromium, expect } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';

// Skills in the composers, review feedback and skills in the chat, and the
// feedback bar after a review, against simulated workspace data.
const server = Fastify();
await server.register(staticFiles, { root: path.resolve('dist') });
await server.listen({ host: '127.0.0.1', port: 0 });
const origin = `http://127.0.0.1:${server.server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PAPILOT_BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const skills = [
  { id: 'polish', name: 'Polish', description: 'Improve clarity and flow, keeping the meaning', hint: 'Which part?', source: 'builtin' },
  { id: 'proofread', name: 'Proofread', description: 'Fix typos, grammar and punctuation without rewording', hint: 'Which part? Leave empty for the whole paper', source: 'builtin' },
  { id: 'venue', name: 'Venue style', description: 'Follow the venue style guide', hint: '', source: 'paper' },
];
const task = { id: 'skill-fixture-0001', projectId: 'paper', name: 'p-skill', title: 'Polish: the introduction', instructions: 'x', worktree: '/tmp/paper-tasks/p-skill', threadId: 't', turnId: null, model: null, status: 'reviewing', createdAt: 1, updatedAt: 1, feedbackCursor: 0, error: null,
  review: { state: 'done', round: 2, counts: { pending: 0, accepted: 2, rejected: 1, commented: 0 }, unsent: 3, comments: 0, files: ['sections/intro.tex'] } };
const snapshot = { version: 'test', csrf: 'fixture', projects: [{ id: 'paper', name: 'Paper', path: '/tmp/paper', createdAt: 1 }], tasks: [task], requests: [], runtime: { connected: true, authenticated: true, account: null, error: null, models: [] } };
const git = { remote: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, head: { hash: 'abc1234', subject: 'Draft', date: 1 }, files: [{ path: 'sections/intro.tex', status: 'M', staged: false, lines: [3, 2] }] };
const items = [
  { id: 'u1', taskId: task.id, type: 'user', text: 'the introduction', meta: { skill: { id: 'polish', name: 'Polish' } }, createdAt: 1 },
  { id: 'a1', taskId: task.id, type: 'assistant', text: 'Rewrote the opening so that $f(x) = \\sum_i x_i$ is defined first.', createdAt: 2 },
  { id: 'u2', taskId: task.id, type: 'user', text: '', meta: { sendsFeedback: true, feedback: { round: 1, accepted: 2, rejected: 1, undone: 0, comments: [{ where: 'sections/intro.tex:12', text: 'Keep the citation here.' }] } }, createdAt: 3 },
  { id: 'u3', taskId: task.id, type: 'user', text: 'Address the comments from this review round. Preserve accepted changes and do not reintroduce rejected edits.', createdAt: 4 },
];
const creates = [], messages = [];
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), json = data => route.fulfill({ json: data });
  if (url.pathname === '/api/state') return json(snapshot);
  if (url.pathname === '/api/events') return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (url.pathname.endsWith('/skills')) return json({ skills });
  if (url.pathname.endsWith('/items')) return json({ items });
  if (url.pathname.endsWith('/git')) return json(git);
  if (url.pathname === '/api/tasks') { const body = route.request().postDataJSON(); creates.push(body); const created = { ...task, id: body.id, title: body.title, review: null, status: 'queued' }; snapshot.tasks.push(created); return json(created); }
  if (url.pathname.endsWith('/messages')) { messages.push(route.request().postDataJSON()); return json({ ok: true }); }
  throw new Error(`Unexpected app request ${url.pathname}`);
});
await page.route('**/review/**', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head></head><body><div class="bar">Review round 2</div><main id="paper"><p>PDF review fixture</p></main></body></html>' }));
const sync = () => page.evaluate(() => window.dispatchEvent(new Event('online')));
try {
  await page.goto(origin);
  // The chat shows the skill, typeset mathematics and feedback, never the prompts.
  const chat = page.locator('.thread');
  await expect(chat.locator('.message.user').first().locator('.skill-chip')).toHaveText('Polish');
  await expect(chat.locator('.katex').first()).toBeVisible();
  await expect(chat.getByText('Review feedback · Round 1')).toBeVisible();
  await expect(chat.locator('.feedback-counts').first()).toHaveText('2 accepted1 rejected1 comment');
  await expect(chat.getByText('Keep the citation here.')).toBeVisible();
  await expect(chat.getByText(/Address the comments/)).toHaveCount(0);
  await expect(chat.locator('.notes-message')).toHaveCount(2);

  // A finished review that accepted changes needs nothing more: they are in
  // the manuscript, and the decisions reach the agent with the next message.
  await expect(page.locator('.task-identity .status')).toHaveText('Review complete');
  await expect(page.getByRole('button', { name: 'Send feedback', exact: true })).toHaveCount(0);
  await expect(page.locator('.review-feedback')).toHaveCount(0);
  // Comments go back to the agent; in the chat-only view the bar ends the conversation.
  task.review = { ...task.review, unsent: 4, comments: 1 }; await sync();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.thread .review-feedback.card:not(.commit-card)')).toContainText('4 review updates not sent yet');
  // The accepted change is in the manuscript; committing it is offered, not required.
  await expect(page.locator('.thread .commit-card')).toContainText('Accepted changes are not committed yet');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await expect.poll(() => messages.length).toBe(1);
  assert.equal(messages[0].feedback, true);
  task.review = { ...task.review, unsent: 0, comments: 0 }; await sync();

  // "/" lists skills in the follow-up composer; the chosen one runs without text.
  const followUp = page.getByRole('textbox', { name: 'Instructions for Codex' });
  await expect(page.getByText('Enter to send · / for skills', { exact: true })).toBeVisible();
  await followUp.fill('/');
  await expect(page.getByRole('option')).toHaveCount(3);
  await followUp.press('ArrowDown');
  await expect(page.getByRole('option', { name: /Proofread/ })).toHaveAttribute('aria-selected', 'true');
  await followUp.press('Enter');
  await expect(page.locator('.composer-skill .skill-chip')).toContainText('Proofread');
  await expect(followUp).toHaveValue('');
  await expect(followUp).toHaveAttribute('placeholder', 'Which part? Leave empty for the whole paper');
  await followUp.press('Backspace');
  await expect(page.locator('.composer-skill')).toHaveCount(0);
  await followUp.fill('/ven');
  await expect(page.getByRole('option')).toHaveText([/Venue style.*This paper/]);
  await followUp.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await followUp.fill('/venue');
  await followUp.press('Tab');
  await page.getByRole('button', { name: 'Send instructions' }).click();
  await expect.poll(() => messages.length).toBe(2);
  assert.equal(messages[1].skill, 'venue'); assert.equal(messages[1].text, '');
  await expect(page.locator('.composer-skill')).toHaveCount(0);

  // The new-task page starts from a suggested skill.
  await page.getByRole('button', { name: 'New task', exact: true }).click();
  await page.getByRole('group', { name: 'Start from a skill' }).getByRole('button', { name: 'Proofread' }).click();
  await expect(page.getByRole('group', { name: 'Start from a skill' }).getByRole('button', { name: 'Proofread' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('Section 2 only.');
  await page.screenshot({ path: 'test-results/skill-new-task.png' });
  await page.keyboard.press('Enter');
  await expect.poll(() => creates.length).toBe(1);
  assert.equal(creates[0].skill, 'proofread'); assert.equal(creates[0].instructions, 'Section 2 only.'); assert.equal(creates[0].title, 'Proofread: Section 2 only');
  assert.deepEqual(errors, []);
  console.log('PASS: Skills from "/" and suggestions; skills, feedback and math in the chat; feedback only for comments');
} finally { await browser.close(); await server.close(); }
