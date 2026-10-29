import type { Skill } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

// "/" at the start of an empty composer lists skills, and typing narrows them:
// names that start with the query first, then any that mention it.
export const skillQuery = (value: string) => /^\/([\w-]*)$/.exec(value)?.[1].toLowerCase() ?? null;
export function matchSkills(skills: Skill[], query: string) {
  const keys = (skill: Skill) => [skill.id, skill.name.toLowerCase().replace(/\s+/g, '-')];
  const starts = skills.filter(skill => keys(skill).some(key => key.startsWith(query)));
  const mentions = skills.filter(skill => !starts.includes(skill) && (keys(skill).some(key => key.includes(query)) || skill.description.toLowerCase().includes(query)));
  return [...starts, ...mentions];
}

export function SkillMenu({ id, skills, active, onPick, onActive }: { id: string; skills: Skill[]; active: number; onPick: (skill: Skill) => void; onActive: (index: number) => void }) {
  return <div className="skill-menu" role="listbox" id={id} aria-label={t('Skills')}>
    {skills.length ? skills.map((skill, index) => <div key={skill.id} role="option" id={`${id}-${index}`} aria-selected={index === active} className={'skill-option' + (index === active ? ' active' : '')}
      onPointerDown={event => { event.preventDefault(); onPick(skill); }} onPointerEnter={() => onActive(index)}>
      <span className="skill-name"><Icon name="spark" size={14}/>{skill.name}</span>
      <span className="skill-description">{skill.description}</span>
      {skill.source !== 'builtin' && <span className="skill-source">{skill.source === 'paper' ? t('This paper') : t('Yours')}</span>}
    </div>) : <p className="skill-empty">{t('No skill matches. Press Enter to send the text as it is.')}</p>}
  </div>;
}

export function SkillChip({ skill, onRemove }: { skill: { id: string; name: string }; onRemove?: () => void }) {
  return <span className="skill-chip" title={t('Skill: {name}', { name: skill.name })}><Icon name="spark" size={13}/>{skill.name}
    {onRemove && <button type="button" aria-label={t('Remove the {name} skill', { name: skill.name })} onClick={onRemove}><Icon name="close" size={12}/></button>}</span>;
}

// The new-task page offers skills as one-tap starting points.
export function SkillSuggestions({ skills, selected, onPick, disabled }: { skills: Skill[]; selected: Skill | null; onPick: (skill: Skill | null) => void; disabled?: boolean }) {
  if (!skills.length) return null;
  return <div className="skill-suggestions" role="group" aria-label={t('Start from a skill')}>
    {skills.slice(0, 8).map(skill => <button key={skill.id} type="button" disabled={disabled} aria-pressed={selected?.id === skill.id} title={skill.description} onClick={() => onPick(selected?.id === skill.id ? null : skill)}><Icon name="spark" size={14}/>{skill.name}</button>)}
  </div>;
}
