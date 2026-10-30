import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSkill } from '../src/server/skills.ts';
import { browserLanguage, t, tn } from '../src/web/i18n.ts';
import { zhCN } from '../src/web/zh-CN.ts';

// Every message the workspace shows: t('…') and both forms of tn(n, '…', '…').
function messages() {
  const found = new Set<string>();
  const pattern = /\bt\(\s*'((?:[^'\\]|\\.)*)'|\btn\([^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
  for (const file of fs.readdirSync('src/web')) {
    if (!/\.tsx?$/.test(file) || file === 'i18n.ts' || file === 'zh-CN.ts') continue;
    for (const match of fs.readFileSync(`src/web/${file}`, 'utf8').matchAll(pattern)) for (const text of match.slice(1)) if (text !== undefined) found.add(text);
  }
  // Built-in skill labels and descriptions arrive as data from the server.
  for (const file of fs.readdirSync('skills').filter(file => file.endsWith('.md'))) {
    const skill = parseSkill(fs.readFileSync(`skills/${file}`, 'utf8'), file, 'builtin');
    if (skill) { found.add(skill.name); found.add(skill.description); }
  }
  return found;
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('every workspace message has a Simplified Chinese translation with the same placeholders', () => {
  const all = messages();
  assert.ok(all.size > 300);
  const missing = [...all].filter(text => !(text in zhCN));
  assert.deepEqual(missing, []);
  for (const text of all) assert.deepEqual(placeholders(zhCN[text]), placeholders(text), text);
  const unused = Object.keys(zhCN).filter(text => !all.has(text));
  assert.deepEqual(unused, [], 'translations no message uses');
});

test('messages fill placeholders and pick English plurals', () => {
  assert.equal(t('Reply to {agent}', { agent: 'Codex' }), 'Reply to Codex');
  assert.equal(tn(1, '{n} comment', '{n} comments'), '1 comment');
  assert.equal(tn(3, '{n} comment', '{n} comments'), '3 comments');
  assert.equal(t('An untranslated message'), 'An untranslated message');
});

test('the browser language picks the first one Papilot speaks', () => {
  assert.equal(browserLanguage(['zh-CN', 'en-US']), 'zh-CN');
  assert.equal(browserLanguage(['zh-TW']), 'zh-CN');
  assert.equal(browserLanguage(['ja-JP', 'en-GB', 'zh-CN']), 'en');
  assert.equal(browserLanguage(['fr-FR']), 'en');
  assert.equal(browserLanguage([]), 'en');
});
