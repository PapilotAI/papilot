import type { Skill } from './shared.ts';

export interface LibrarySkill extends Skill { location: string; active: boolean }
export interface SkillDocument extends LibrarySkill { content: string; revision: string }
export interface SkillCatalog { skills: LibrarySkill[]; locations: { user: string; paper?: string } }
export interface SkillWrite { source: Skill['source']; id: string; content: string; revision?: string; projectId?: string }
