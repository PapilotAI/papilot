import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findSkill, listedSkill, loadSkills, parseSkill } from '../src/server/skills.ts';
import { resolveSkillIcon } from '../src/skill-icons.ts';

test('Papilot ships paper skills with names, descriptions and hints, in order', () => {
  const skills = loadSkills(undefined, { builtin: path.resolve('skills'), user: path.join(os.tmpdir(), 'papilot-no-user-skills-' + process.pid) });
  assert.deepEqual(skills.map(skill => skill.id), ['polish', 'proofread', 'shorten', 'check-math', 'consistency', 'latex-warnings', 'reviewer-response']);
  for (const skill of skills) {
    assert.equal(skill.source, 'builtin');
    assert.ok(skill.name && skill.description && skill.hint && skill.body.length > 100, skill.id);
    assert.doesNotMatch(skill.body, /^---/);
  }
  assert.deepEqual(Object.keys(listedSkill(skills[0])).sort(), ['description', 'hint', 'id', 'name', 'source']);
});

test('the author\'s and the paper\'s skills add to and replace the built-in ones', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'papilot-skills-'));
  try {
    const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true }); fs.writeFileSync(path.join(base, file), text); };
    write('builtin/polish.md', '---\nname: Polish\norder: 1\n---\nBuilt-in polish.');
    write('builtin/proofread.md', '---\nname: Proofread\norder: 2\n---\nBuilt-in proofreading.');
    write('user/polish.md', '---\nname: "My polish"\ndescription: Mine\n---\nThe author\'s polish.');
    write('paper/.papilot/skills/venue/SKILL.md', '---\nname: venue-style\ndescription: Follow the venue\'s style guide\n---\nRead style.md in this folder.');
    write('paper/.papilot/skills/Bad Name.md', 'Ignored.');
    write('paper/.papilot/skills/empty.md', '---\nname: Empty\n---\n');
    write('paper/.papilot/skills/notes.txt', 'Ignored.');
    const skills = loadSkills(path.join(base, 'paper'), { builtin: path.join(base, 'builtin'), user: path.join(base, 'user') });
    assert.deepEqual(skills.map(skill => [skill.id, skill.name, skill.source]), [['proofread', 'Proofread', 'builtin'], ['polish', 'My polish', 'user'], ['venue', 'venue-style', 'paper']]);
    assert.equal(skills.find(skill => skill.id === 'venue')?.folder, path.join(base, 'paper/.papilot/skills/venue'));
    assert.equal(loadSkills(undefined, { builtin: path.join(base, 'missing'), user: path.join(base, 'missing') }).length, 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a skill file without front matter uses its file name, and unknown skills are refused', () => {
  assert.deepEqual(parseSkill('Just instructions.\r\n', 'plain', 'paper'), { id: 'plain', name: 'plain', description: '', hint: '', source: 'paper', body: 'Just instructions.', order: 1000 });
  assert.equal(parseSkill('---\nname: Nothing\n---\n   ', 'nothing', 'paper'), null);
  assert.throws(() => findSkill(os.tmpdir(), 'no-such-skill'), /not available/);
});

test('skill files may start with a byte-order mark and be ordered first with 0', () => {
  const skill = parseSkill('﻿---\nname: First\norder: 0\n---\nDo it.', 'first', 'user');
  assert.equal(skill?.name, 'First');
  assert.equal(skill?.order, 0);
  assert.equal(skill?.body, 'Do it.');
});

test('explicit icons reach the catalog while legacy and invalid icons keep sensible defaults', () => {
  const skill = parseSkill('---\nname: Custom polish\nicon: book\n---\nRevise it.', 'polish', 'user')!;
  assert.equal(listedSkill(skill).icon, 'book');
  assert.equal(resolveSkillIcon(skill), 'book');
  assert.equal(resolveSkillIcon({ id: 'check-math' }), 'sigma');
  assert.equal(resolveSkillIcon({ id: 'custom' }), 'spark');
  assert.equal(resolveSkillIcon({ id: 'constructor' }), 'spark');
  for (const icon of ['missing', '<svg/>', 'https://example.com/icon.svg', '__proto__']) {
    const invalid = parseSkill(`---\nicon: ${icon}\n---\nRevise it.`, 'polish', 'user')!;
    assert.equal(listedSkill(invalid).icon, undefined);
    assert.equal(resolveSkillIcon(invalid), 'spark');
  }
});
