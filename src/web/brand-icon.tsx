import type { CSSProperties } from 'react';
import papilot from './brand-icons/papilot.svg';
import pi from './brand-icons/pi.svg';
import codex from './brand-icons/codex.svg';
import claude from './brand-icons/claude.svg';
import cursor from './brand-icons/cursor.svg';
import copilot from './brand-icons/copilot.svg';
import grok from './brand-icons/grok.svg';
import antigravity from './brand-icons/antigravity.svg';
import kimi from './brand-icons/kimi.svg';
import glm from './brand-icons/glm.svg';
import deepseek from './brand-icons/deepseek.svg';
import qwen from './brand-icons/qwen.svg';
import opencode from './brand-icons/opencode.svg';
import git from './brand-icons/git.svg';
import latex from './brand-icons/latex.svg';
import openai from './brand-icons/openai.svg';
import gemini from './brand-icons/gemini.svg';
import openrouter from './brand-icons/openrouter.svg';
import mistral from './brand-icons/mistral.svg';
import arxiv from './brand-icons/arxiv.svg';
import overleaf from './brand-icons/overleaf.svg';
import github from './brand-icons/github.svg';
import './brand-icon.css';

const marks = { collaboration: codex, papilot, pi, codex, claude, cursor, copilot, grok, antigravity, kimi, glm, deepseek, qwen, opencode, git, latex, openai, gemini, openrouter, mistral, arxiv, overleaf, github };
export type Brand = keyof typeof marks;

// Decorative beside a visible name. Local assets work offline and inherit theme colors.
export function BrandIcon({ name, size = 24 }: { name: Brand; size?: number }) {
  return <i className="brand-icon" data-brand={name} aria-hidden="true" style={{ '--brand-image': `url("${marks[name]}")`, width: size, height: size } as CSSProperties}/>;
}
