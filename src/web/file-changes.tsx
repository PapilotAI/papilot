import type { EditPlace, FileEdit, TimelineItem } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t, tn } from './i18n.ts';
import './file-changes.css';

// What an agent changed, as the chat shows it: an edit opens to its diff,
// and a turn that changed the paper ends with a summary of where, by part of
// the paper ("§2.2 A Simple Implementation, p. 4") rather than by file.

const count = (edit: Pick<EditPlace, 'added' | 'removed'>) => <span className="change-count"><ins>+{edit.added}</ins> <del>−{edit.removed}</del></span>;
export const placeName = (place: EditPlace) => place.sections.map(section => section.number ? t('§{number} {title}', { number: section.number, title: section.title }) : section.title).join(t(', '));

/** A file's diff, one line per row, marked added or removed. */
function Diff({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, '').split('\n').filter(line => !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('\\'));
  return <pre className="file-diff">{lines.map((line, index) => {
    const kind = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'same';
    return <span key={index} className={'diff-line ' + kind}>{kind === 'hunk' ? '⋯' : line || ' '}{'\n'}</span>;
  })}</pre>;
}

/** The diffs of one edit call, each under its file and where it is in the paper. */
export function FileDiffs({ changes, files }: { changes?: FileEdit[]; files: string[] }) {
  if (!changes?.some(change => change.diff)) return files.length ? <pre>{files.join('\n')}</pre> : null;
  return <div className="file-diffs">{changes.map(change => <section key={change.path}>
    <header><span className="file-diff-path">{change.path}</span>{change.places?.length ? <span className="file-diff-where">{change.places.filter(place => place.sections.length).map(placeName).filter((name, i, all) => all.indexOf(name) === i).join(t(', '))}</span> : null}{count(change)}</header>
    {change.diff && <Diff diff={change.diff}/>}
  </section>)}</div>;
}

/** Where a turn changed the paper, added up across its edits. */
export function ChangeSummary({ items }: { items: TimelineItem[] }) {
  type Row = { key: string; name: string; page?: string; file: string; lines: string[]; added: number; removed: number };
  const rows = new Map<string, Row>(), files = new Set<string>();
  for (const change of items.flatMap(item => item.changes || [])) {
    files.add(change.path);
    const places = change.places?.length ? change.places : [{ sections: [], lines: '', added: change.added, removed: change.removed } as EditPlace];
    for (const place of places) {
      const name = place.sections.length ? placeName(place) : '', key = `${change.path}\n${name}`;
      const row = rows.get(key) || { key, name, page: place.page, file: change.path, lines: [], added: 0, removed: 0 };
      row.added += place.added; row.removed += place.removed;
      if (place.lines) row.lines.push(place.lines);
      rows.set(key, row);
    }
  }
  if (!rows.size) return null;
  const list = [...rows.values()];
  const places = list.filter(row => row.name).length;
  return <section className="change-summary" aria-label={t('Changes')}>
    <header><Icon name="diff" size={14}/><strong>{t('Changes')}</strong><span>{places ? tn(places, '{n} place in the paper', '{n} places in the paper') + (files.size > 1 ? ' · ' + tn(files.size, '{n} file', '{n} files') : '') : tn(files.size, '{n} file', '{n} files')}</span></header>
    <ul>{list.map(row => <li key={row.key}>
      <span className="change-where">{row.name || row.file}{row.page && <span className="change-page">{t('p. {page}', { page: row.page })}</span>}</span>
      {count(row)}
      {row.name && <span className="change-file">{row.lines.length ? t('{file}, lines {lines}', { file: row.file, lines: row.lines.join(t(', ')) }) : row.file}</span>}
    </li>)}</ul>
  </section>;
}
