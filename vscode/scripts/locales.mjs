import fs from 'node:fs/promises';
import path from 'node:path';
import { collectCatalog, readLegacyChinese } from '../../scripts/i18n/catalog.ts';

/** Package the existing translations in VS Code's native localization formats. */
export async function buildLocales(root) {
  const project = path.resolve(root, '..');
  const messages = collectCatalog(project).messages.filter(message => message.occurrences.some(item => item.file.startsWith('vscode/src/')));
  const labels = JSON.parse(await fs.readFile(path.join(root, 'package.nls.json'), 'utf8'));
  const directory = path.join(root, 'dist/l10n');
  await fs.mkdir(directory, { recursive: true });
  const locales = JSON.parse(await fs.readFile(path.join(project, 'i18n/config.json'), 'utf8')).locales;
  for (const locale of Object.keys(locales)) {
    const dictionary = JSON.parse(await fs.readFile(path.join(project, 'src/web/locales', locale + '.json'), 'utf8'));
    if (locale === 'zh-CN') Object.assign(dictionary, readLegacyChinese(project));
    const translated = source => {
      if (!dictionary[source]) throw new Error(`Missing ${locale} translation: ${source}`);
      return dictionary[source];
    };
    // VS Code's display-language identifiers differ from the app's catalog names.
    const language = ({ 'zh-CN': 'zh-cn', 'zh-Hant': 'zh-tw', pt: 'pt-br' })[locale] || locale;
    await fs.writeFile(path.join(directory, `bundle.l10n.${language}.json`), JSON.stringify(Object.fromEntries(messages.map(({ source }) => [source, translated(source)])), null, 2) + '\n');
    await fs.writeFile(path.join(root, `package.nls.${language}.json`), JSON.stringify(Object.fromEntries(Object.entries(labels).map(([key, source]) => [key, translated(source)])), null, 2) + '\n');
  }
}
