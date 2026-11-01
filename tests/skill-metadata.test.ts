import test from 'node:test';
import assert from 'node:assert/strict';
import { skillMetadata, skillInstructions, setSkillMetadata, setSkillInstructions } from '../src/skill-metadata.ts';

test('visual edits preserve unknown metadata, instruction bytes, BOM and line endings', () => {
  const source = '\uFEFF---\r\nname: Original\r\nhint: Which section?\r\norder: 0\r\ncustom-field: keep me\r\n---\r\n\r\n# Instructions\r\nKeep $x$.\r\n';
  const updated = setSkillMetadata(setSkillMetadata(source, 'icon', 'book'), 'name', 'A "quoted" name: 中文');
  assert.equal(skillMetadata(updated).name, 'A "quoted" name: 中文');
  assert.equal(skillMetadata(updated).icon, 'book');
  assert.equal(skillMetadata(updated).hint, 'Which section?');
  assert.equal(skillMetadata(updated).order, '0');
  assert.match(updated, /custom-field: keep me\r\n/);
  assert.ok(updated.startsWith('\uFEFF---\r\n'));
  assert.equal(skillInstructions(updated), skillInstructions(source));
  const body = '\r\nNew **instructions**.\r\n';
  assert.equal(skillInstructions(setSkillInstructions(updated, body)), body);
  assert.deepEqual(skillMetadata(setSkillInstructions(updated, body)), skillMetadata(updated));
});

test('headerless skills can receive an icon and duplicate fields do not override a visual edit', () => {
  const plain = 'Use short sentences.\n';
  const withIcon = setSkillMetadata(plain, 'icon', 'pen');
  assert.equal(withIcon, '---\nicon: pen\n---\n\nUse short sentences.\n');
  assert.equal(setSkillInstructions(plain, 'New instructions.'), 'New instructions.');
  const duplicate = setSkillMetadata('---\nicon: spark\nICON: sigma\ncustom: yes\n---\nText.', 'icon', 'book');
  assert.equal(skillMetadata(duplicate).icon, 'book');
  assert.equal(duplicate.match(/^icon:/gim)?.length, 1);
  assert.equal(skillMetadata(duplicate).custom, 'yes');
  assert.equal(skillInstructions(setSkillInstructions('---\nname: Draft\n---', 'Start here.')), 'Start here.');
});
