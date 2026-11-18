import type { NoteSection } from '../shared.ts';
import { ActionMenu } from './action-menu.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './section-note-picker.css';

export function SectionNotePicker({ sections, notes, disabled, has, select, onAdded }: { sections: NoteSection[]; notes: string[]; disabled: boolean; has: (id: string) => boolean; select: (ids: string[], checked: boolean) => void; onAdded: () => void }) {
  const available = sections.filter(section => section.notes.length > 0);
  const allSelected = notes.every(has);
  const add = (ids: string[]) => { select(ids, true); onAdded(); };
  if (!available.length && !notes.length) return null;
  // Without an outline, retain the ordinary bulk action without an empty menu.
  if (!available.length) return <button type="button" className="note-select-all section-note-trigger" aria-label={t('Select all notes for this task')} aria-pressed={allSelected ? true : notes.some(has) ? 'mixed' : false} disabled={disabled} onClick={() => select(notes, !allSelected)}><span>{allSelected ? t('Remove all from task') : t('Add all to task')}</span></button>;
  const level = Math.min(...available.map(section => section.level));
  return <ActionMenu label={t('Add to task')} className="note-select-all section-note-trigger" menuClassName="section-note-menu" disabled={disabled} actions={[
    ...(notes.length ? [{ label: allSelected ? t('Remove all from task') : t('Add all to task'), select: () => allSelected ? select(notes, false) : add(notes) }] : []),
    ...available.map((section, index) => {
      const selected = section.notes.filter(has).length, total = section.notes.length;
      return { id: section.id, label: section.title, hint: selected ? `${selected}/${total}` : String(total),
        title: `${t('Includes subsections')} · ${t('{selected} of {total} selected', { selected, total })}`,
        indent: Math.max(0, Math.min(6, section.level - level)), divider: index === 0 && notes.length > 0,
        disabled: disabled || selected === total, select: () => add(section.notes) };
    }),
  ]}><span>{t('Add to task')}</span><Icon name="chevronDown" size={12}/></ActionMenu>;
}
