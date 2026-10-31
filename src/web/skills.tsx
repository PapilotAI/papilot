import type { Skill } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { ActionMenu } from './action-menu.tsx';

const skillIcons: Record<string, string> = {
  polish: 'spark', proofread: 'spellcheck', shorten: 'compress', 'check-math': 'sigma',
  consistency: 'checklist', 'latex-warnings': 'tool', 'reviewer-response': 'notes',
};
export const skillIcon = (id: string) => skillIcons[id] || 'spark';

// Built-in metadata is English on disk; display it in the interface language.
// Older chat entries store only the skill's id and name.
export const skillName = (skill: { name: string; source?: Skill['source'] }) => !skill.source || skill.source === 'builtin' ? t(skill.name) : skill.name;
export const skillDescription = (skill: Skill) => skill.source === 'builtin' ? t(skill.description) : skill.description;

// "/" at the start of an empty composer lists skills, and typing narrows them:
// names that start with the query first, then any that mention it.
export const skillQuery = (value: string) => /^\/([\p{L}\p{M}\p{N}_-]*)$/u.exec(value)?.[1].toLowerCase() ?? null;
export function matchSkills(skills: Skill[], query: string) {
  const keys = (skill: Skill) => [skill.id, skill.name, skillName(skill)].map(name => name.toLowerCase().replace(/\s+/g, '-'));
  const starts = skills.filter(skill => keys(skill).some(key => key.startsWith(query)));
  const mentions = skills.filter(skill => !starts.includes(skill) && (keys(skill).some(key => key.includes(query)) || [skill.description, skillDescription(skill)].some(description => description.toLowerCase().includes(query))));
  return [...starts, ...mentions];
}

export function SkillMenu({ id, skills, active, onPick, onActive }: { id: string; skills: Skill[]; active: number; onPick: (skill: Skill) => void; onActive: (index: number) => void }) {
  return <div className="skill-menu" role="listbox" id={id} aria-label={t('Skills')}>
    {skills.length ? skills.map((skill, index) => <div key={skill.id} role="option" id={`${id}-${index}`} title={skillDescription(skill)} aria-selected={index === active} className={'skill-option' + (index === active ? ' active' : '')}
      onPointerDown={event => { event.preventDefault(); onPick(skill); }} onPointerEnter={() => onActive(index)}>
      <span className="skill-name"><Icon name={skillIcon(skill.id)} size={14}/>{skillName(skill)}</span>
      {skill.source !== 'builtin' && <span className="skill-source">{skill.source === 'paper' ? t('This paper') : t('Yours')}</span>}
    </div>) : <p className="skill-empty">{t('No matching skills')}</p>}
  </div>;
}

export function SkillChip({ skill, onRemove }: { skill: { id: string; name: string; source?: Skill['source'] }; onRemove?: () => void }) {
  const name = skillName(skill);
  return <span className="skill-chip" title={t('Skill: {name}', { name })}><Icon name={skillIcon(skill.id)} size={13}/>{name}
    {onRemove && <button type="button" aria-label={t('Remove the {name} skill', { name })} onClick={onRemove}><Icon name="close" size={12}/></button>}</span>;
}

// Skills stay behind the composer's plus button; "/" remains the keyboard shortcut.
export function SkillPicker({ skills, selected, onPick, disabled, onAttach }: { skills: Skill[]; selected: Skill | null; onPick: (skill: Skill | null) => void; disabled?: boolean; onAttach?: () => void }) {
  if (!skills.length && !onAttach) return null;
  return <ActionMenu label={onAttach ? t('Add files or skills') : t('Add skill')} className="icon-button composer-plus" menuClassName="skills-picker-menu" align="start" disabled={disabled}
    actions={[...(onAttach ? [{ label: t('Add files…'), icon: 'attachment', select: onAttach }] : []), ...skills.map((skill, index) => ({ id: skill.id, label: skillName(skill), title: skillDescription(skill), icon: skillIcon(skill.id), divider: Boolean(onAttach && index === 0), checked: selected?.id === skill.id, select: () => onPick(selected?.id === skill.id ? null : skill) }))]}><Icon name="plus" size={19}/></ActionMenu>;
}
