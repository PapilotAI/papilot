import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error The build helper runs directly in Node, outside the TS project.
import { buildLocales } from '../scripts/locales.mjs';

test('native prompts and manifest labels are packaged from the shared locale catalog', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'papilot-l10n-'));
  const root = path.join(project, 'extensions/vscode');
  const write = async (file: string, text: string) => { const target = path.join(project, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
  try {
    await fs.mkdir(path.join(project, 'skills'));
    await write('src/web/zh-CN.ts', 'export const zhCN = {};');
    await write('extensions/vscode/src/extension.ts', "import { t } from './i18n.ts'; t('Instructions for {document}', { document: 'main.tex' });");
    await write('extensions/vscode/package.nls.json', JSON.stringify({ 'papilot.open.title': 'Open PDF' }));
    const dictionaries = {
      de: ['Anweisungen für {document}', 'PDF öffnen'],
      'zh-CN': ['给 {document} 的指令', '打开 PDF'],
      'zh-Hant': ['給 {document} 的指令', '開啟 PDF'],
      pt: ['Instruções para {document}', 'Abrir PDF'],
    };
    await write('i18n/config.json', JSON.stringify({ locales: Object.fromEntries(Object.keys(dictionaries).map(locale => [locale, {}])) }));
    for (const [locale, [instructions, open]] of Object.entries(dictionaries)) await write(`src/web/locales/${locale}.json`, JSON.stringify({ 'Instructions for {document}': instructions, 'Open PDF': open }));
    await buildLocales(root);
    for (const [locale, language] of [['de', 'de'], ['zh-CN', 'zh-cn'], ['zh-Hant', 'zh-tw'], ['pt', 'pt-br']] as const) {
      const bundle = JSON.parse(await fs.readFile(path.join(root, `dist/l10n/bundle.l10n.${language}.json`), 'utf8'));
      const labels = JSON.parse(await fs.readFile(path.join(root, `package.nls.${language}.json`), 'utf8'));
      assert.equal(bundle['Instructions for {document}'], dictionaries[locale][0]);
      assert.equal(labels['papilot.open.title'], dictionaries[locale][1]);
    }
    await write('src/web/locales/de.json', '{}');
    await assert.rejects(buildLocales(root), /Missing de translation/);
  } finally { await fs.rm(project, { recursive: true, force: true }); }
});
