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
import zcode from './brand-icons/zcode.svg';
import deepseek from './brand-icons/deepseek.svg';
import qwen from './brand-icons/qwen.svg';
import opencode from './brand-icons/opencode.svg';
import qoder from './brand-icons/qoder.svg';
import codebuddy from './brand-icons/codebuddy.svg';
import workbuddy from './brand-icons/workbuddy.svg';
import git from './brand-icons/git.svg';
import latex from './brand-icons/latex.svg';
import openai from './brand-icons/openai.svg';
import gemini from './brand-icons/gemini.svg';
import openrouter from './brand-icons/openrouter.svg';
import mistral from './brand-icons/mistral.svg';
import arxiv from './brand-icons/arxiv.svg';
import overleaf from './brand-icons/overleaf.svg';
import github from './brand-icons/github.svg';
import zotero from './brand-icons/zotero.svg';
import { PapilotMark } from './papilot-mark.tsx';
import { Icon } from './icons.tsx';
import './brand-icon.css';

const marks = { collaboration: papilot, papilot, pi, codex, claude, cursor, copilot, grok, antigravity, kimi, glm, zcode, deepseek, qwen, opencode, qoder, codebuddy, workbuddy, git, latex, openai, gemini, openrouter, mistral, arxiv, overleaf, github, zotero };
export type Brand = keyof typeof marks;

// Decorative beside a visible name. Local assets work offline and inherit theme colors.
export function BrandIcon({ name, size = 24 }: { name: Brand; size?: number }) {
  // Papilot Writer uses Papilot's own mark in full colour; Collaboration mode uses a workflow mark.
  if (name === 'papilot') return <PapilotMark size={size} className="brand-icon"/>;
  if (name === 'collaboration') return <span className="brand-icon brand-icon-svg" data-brand={name} aria-hidden="true" style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="workflow" size={size}/></span>;
  return <i className="brand-icon" data-brand={name} aria-hidden="true" style={{ '--brand-image': `url("${marks[name]}")`, width: size, height: size } as CSSProperties}/>;
}
