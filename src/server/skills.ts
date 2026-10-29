import fs from 'node:fs';
import path from 'node:path';
import { DATA, ROOT } from './paths.ts';
import type { Skill } from '../shared.ts';

// Skills are Markdown instructions an author runs with "/" in the composer.
// Papilot ships some in skills/; the data folder's skills/ adds the author's
// own for every paper, and a paper's .papilot/skills/ its own. A later source
// replaces an earlier skill with the same name. Each skill is <name>.md, or a
// folder with a SKILL.md (the Agent Skills layout) whose other files the
// agent may read. Front matter gives its name, description, composer hint
// and order.
export interface SkillFile extends Skill { body: string; folder?: string; order: number }
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function parseSkill(text: string, id: string, source: Skill['source'], folder?: string): SkillFile | null {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const header = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text), fields: Record<string, string> = {};
  for (const line of header?.[1].split('\n') || []) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1].toLowerCase()] = field[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const body = text.slice(header ? header[0].length : 0).trim().slice(0, 20000);
  if (!body) return null;
  return { id, name: (fields.name || id).slice(0, 60), description: (fields.description || '').slice(0, 300), hint: (fields.hint || '').slice(0, 200), source, body, ...(folder ? { folder } : {}), order: fields.order && Number.isFinite(Number(fields.order)) ? Number(fields.order) : 1000 };
}

function read(dir: string, source: Skill['source']): SkillFile[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const found: SkillFile[] = [];
  for (const entry of entries) {
    const id = entry.name.replace(/\.md$/i, '').toLowerCase();
    if (!NAME.test(id)) continue;
    try {
      const skill = entry.isDirectory() ? parseSkill(fs.readFileSync(path.join(dir, entry.name, 'SKILL.md'), 'utf8'), id, source, path.join(dir, entry.name))
        : entry.isFile() && /\.md$/i.test(entry.name) ? parseSkill(fs.readFileSync(path.join(dir, entry.name), 'utf8'), id, source) : null;
      if (skill) found.push(skill);
    } catch { /* A folder without a readable SKILL.md is not a skill. */ }
  }
  return found;
}

export function loadSkills(paper?: string, roots = { builtin: path.join(ROOT, 'skills'), user: path.join(DATA, 'skills') }): SkillFile[] {
  const skills = new Map<string, SkillFile>();
  const sources: [string, Skill['source']][] = [[roots.builtin, 'builtin'], [roots.user, 'user'], ...(paper ? [[path.join(paper, '.papilot', 'skills'), 'paper'] as [string, Skill['source']]] : [])];
  for (const [dir, source] of sources) for (const skill of read(dir, source)) skills.set(skill.id, skill);
  return [...skills.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function findSkill(paper: string, id: string) {
  const skill = loadSkills(paper).find(item => item.id === id);
  if (!skill) throw new Error(`The skill "${id}" is not available for this paper.`);
  return skill;
}

export const listedSkill = ({ id, name, description, hint, source }: SkillFile): Skill => ({ id, name, description, hint, source });
