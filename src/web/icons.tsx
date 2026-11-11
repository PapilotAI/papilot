import { editorIcons } from '../../engine/src/web/editor-icons.tsx';
import type { SkillIcon } from '../skill-icons.ts';

// Papilot's own glyphs in Apple's symbol language: compact, rounded, closed
// shapes with continuous-looking corners, one stroke weight, and filled
// details where a dot or a play mark reads better solid. A shape marked
// `icon-fill` is the glyph's body; selected controls tint it.
const doc = 'M14 2.75H7.5A2.75 2.75 0 0 0 4.75 5.5v13a2.75 2.75 0 0 0 2.75 2.75h9a2.75 2.75 0 0 0 2.75-2.75V8Z';
const fold = 'M14 2.75V6.5A1.5 1.5 0 0 0 15.5 8h3.75';
const pane = <rect className="icon-fill" x="2.75" y="4" width="18.5" height="16" rx="3.5"/>;
const ring = <circle cx="12" cy="12" r="9"/>;
const dot = (cx: number, cy: number, r = 1.15) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none"/>;
const bubble = 'M7 4h10a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-5.5L7 21v-3a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z';
const lens = <><circle className="icon-fill" cx="10.5" cy="10.5" r="6.75"/><path strokeWidth="2.2" d="m15.6 15.6 4.4 4.4"/></>;
const box = 'M9 9H7.5A2.5 2.5 0 0 0 5 11.5v7A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-7A2.5 2.5 0 0 0 16.5 9H15';
const star = (x: number, y: number, r: number) => {
  const [a, b, c, d] = [.13, .38, .62, .87].map(k => +(k * r).toFixed(2));
  return `M${x} ${+(y - r).toFixed(2)}c${a} ${c} ${b} ${d} ${r} ${r}c-${c} ${a}-${d} ${b}-${r} ${r}c-${a}-${c}-${b}-${d}-${r}-${r}c${c}-${a} ${d}-${b} ${r}-${r}Z`;
};

const paths: Record<string, React.ReactNode> & Record<SkillIcon, React.ReactNode> = {
  ...editorIcons,
  redo: <path d="M15.5 4.5 20 9l-4.5 4.5M20 9H9.5a5.5 5.5 0 0 0 0 11h3"/>,
  info: <>{ring}<path d="M10.75 10.75H12v6M10.5 16.75h3"/>{dot(12, 7.6)}</>,
  github: <><path d="M9 19c-4.3 1.3-4.3-2.1-6-2.5m12 5v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.7 4.9 4.9 0 0 0-.1-3.6s-1.1-.3-3.8 1.4a13.2 13.2 0 0 0-7 0C5.3.5 4.2.8 4.2.8A4.9 4.9 0 0 0 4.1 4.4a5.3 5.3 0 0 0-1.4 3.7c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.7v3.9"/></>,
  keyboard: <><rect x="2.5" y="5.25" width="19" height="13.5" rx="3"/>{[6, 9, 12, 15, 18].map(x => <g key={x}>{dot(x, 9.25, .95)}{dot(x, 12.25, .95)}</g>)}<path d="M8.5 15.5h7"/></>,
  sun: <><circle className="icon-fill" cx="12" cy="12" r="4.25"/><path d="M12 2.75v2m0 14.5v2M2.75 12h2m14.5 0h2M5.46 5.46l1.41 1.41m10.26 10.26 1.41 1.41m0-13.08-1.41 1.41M6.87 17.13l-1.41 1.41"/></>,
  moon: <path className="icon-fill" d="M20 14.5A8.5 8.5 0 1 1 9.5 4 8 8 0 0 0 20 14.5Z"/>,
  plus: <path d="M12 4.75v14.5M4.75 12h14.5"/>,
  grip: <>{dot(9, 6, 1.3)}{dot(9, 12, 1.3)}{dot(9, 18, 1.3)}{dot(15, 6, 1.3)}{dot(15, 12, 1.3)}{dot(15, 18, 1.3)}</>,
  attachment: <path d="m15.5 6.6-7.1 7.1a1.8 1.8 0 0 0 2.55 2.55l7.4-7.4a3.8 3.8 0 0 0-5.4-5.4l-7.45 7.45a5.8 5.8 0 0 0 8.2 8.2l5.6-5.6"/>,
  archive: <><path className="icon-fill" d="M5.5 3.5h13a2 2 0 0 1 2 2V7a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V5.5a2 2 0 0 1 2-2Z"/><path d="M5 8v9.5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8m-9 4h4"/></>,
  folder: <><path className="icon-fill" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.7a2 2 0 0 1 1.45.62L12 6h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M3 9.25h18"/></>,
  restore: <path d="M4.25 12a7.75 7.75 0 1 0 2.27-5.48L4 9m0-4.75V9h4.75M12 8v4.5l3 1.75"/>,
  bolt: <path className="icon-fill" d="M13.2 2.85 5.05 13.1c-.4.5-.04 1.25.6 1.25H11l-1.15 6.3c-.11.62.67.98 1.06.48l8.04-10.23c.4-.5.04-1.25-.6-1.25H13l1.2-6.3c.11-.62-.66-.98-1.05-.5Z"/>,
  compose: <><path d="M11 4.5H7.5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V13"/><path className="icon-fill" d="M17.35 3.65a1.9 1.9 0 0 1 2.7 2.7l-7.55 7.55-3.4.9.9-3.4Z"/></>,
  sidebar: <>{pane}<path d="M9.25 4v16M5.6 8h1m-1 2.75h1m-1 2.75h1"/></>,
  panelCollapse: <>{pane}<path d="M14.75 4v16M8.25 9.5l2.5 2.5-2.5 2.5"/></>,
  panelExpand: <>{pane}<path d="M14.75 4v16M10.75 9.5 8.25 12l2.5 2.5"/></>,
  menu: <path d="M4.5 6.5h15m-15 5.5h15m-15 5.5h15"/>,
  arrowUp: <path d="M12 19.5V4.75M5.75 11 12 4.75 18.25 11"/>,
  arrowDown: <path d="M12 4.5v14.75M5.75 13 12 19.25 18.25 13"/>,
  arrowRight: <path d="M4.5 12h14.75M13 5.75 19.25 12 13 18.25"/>,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.75" fill="currentColor" stroke="none"/>,
  updown: <path d="m8 9.25 4-4 4 4m-8 5.5 4 4 4-4"/>,
  more: <>{dot(5.5, 12, 1.55)}{dot(12, 12, 1.55)}{dot(18.5, 12, 1.55)}</>,
  external: <path d="M11 4.5H7.5a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3V13m-5.5-8.5h5.5V10m0-5.5L11 13"/>,
  share: <path d={`${box}M12 14.5V3M8.5 6.5 12 3l3.5 3.5`}/>,
  download: <path d={`${box}M12 3v11.5M8.5 11l3.5 3.5 3.5-3.5`}/>,
  paper: <><path className="icon-fill" d={doc}/><path d={`${fold}M8.5 12.25h7m-7 3.5h7m-7-7h2.5`}/></>,
  compile: <path d="M7 5.4v13.2a1.4 1.4 0 0 0 2.1 1.2l11-6.6a1.4 1.4 0 0 0 0-2.4l-11-6.6A1.4 1.4 0 0 0 7 5.4Z" fill="currentColor" stroke="none"/>,
  pdf: <><path className="icon-fill" d="M4.75 10V5.5a2.75 2.75 0 0 1 2.75-2.75H14L19.25 8v2"/><path d={`${fold}M4.75 19a2.25 2.25 0 0 0 2.25 2.25h10A2.25 2.25 0 0 0 19.25 19`}/><path strokeWidth="1.4" d="M2.75 18v-5.75h1.9a1.85 1.85 0 0 1 0 3.7h-1.9M9.6 12.25V18h1.3a2.88 2.88 0 0 0 0-5.75ZM16.85 18v-5.75h3.9m-3.9 2.85h3.1"/></>,
  chat: <path className="icon-fill" d={bubble}/>,
  split: <>{pane}<path d="M12 4v16"/></>,
  terminal: <><rect className="icon-fill" x="2.75" y="4" width="18.5" height="16" rx="3.5"/><path d="m7.25 9.25 2.75 2.75-2.75 2.75m5.25 0h4.25"/></>,
  diff: <><path className="icon-fill" d={doc}/><path d={`${fold}M12 9.75v5m-2.5-2.5h5m-5 4.75h5`}/></>,
  tool: <path className="icon-fill" d="M14.6 3.4a5 5 0 0 0-5.35 6.85l-5.4 5.4a2.12 2.12 0 0 0 3 3l5.4-5.4a5 5 0 0 0 6.85-5.35l-2.85 2.85-2.75-.75-.75-2.75Z"/>,
  log: <><path className="icon-fill" d={doc}/><path d={`${fold}M8.5 12.25h7m-7 3.5h4.5`}/></>,
  alert: <>{ring}<path d="M12 7.5v5.25"/>{dot(12, 16.4)}</>,
  trash: <path d="M4 6.5h16M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5m-9.25 0 .85 12.3a2.5 2.5 0 0 0 2.5 2.2h5.8a2.5 2.5 0 0 0 2.5-2.2l.85-12.3M10 10.5v6m4-6v6"/>,
  pause: <><rect x="6.75" y="5" width="3.25" height="14" rx="1.6" fill="currentColor" stroke="none"/><rect x="14" y="5" width="3.25" height="14" rx="1.6" fill="currentColor" stroke="none"/></>,
  search: lens,
  region: <><path d="M3.5 7.5v-1a3 3 0 0 1 3-3h1m3.5 0h2m3.5 0h1a3 3 0 0 1 3 3v1M3.5 11v2m0 3.5v1a3 3 0 0 0 3 3h1m3.5 0h.5"/><path d="M12.75 12.75 20.5 15.7l-3.35 1.45-1.45 3.35Z" fill="currentColor"/></>,
  list: <>{dot(4.75, 6.5, 1.3)}{dot(4.75, 12, 1.3)}{dot(4.75, 17.5, 1.3)}<path d="M9 6.5h11M9 12h11M9 17.5h11"/></>,
  chevronDown: <path d="m5.5 9.25 6.5 6.5 6.5-6.5"/>,
  chevronUp: <path d="m5.5 14.75 6.5-6.5 6.5 6.5"/>,
  chevronLeft: <path d="M14.75 5.5 8.25 12l6.5 6.5"/>,
  chevronRight: <path d="m9.25 5.5 6.5 6.5-6.5 6.5"/>,
  minus: <path d="M5 12h14"/>,
  branch: <><circle cx="6.5" cy="5.75" r="2.25"/><circle cx="6.5" cy="18.25" r="2.25"/><circle cx="17.5" cy="5.75" r="2.25"/><path d="M6.5 8v8m11-8c0 5-4.3 5.6-7.4 6.4-1.5.4-2.6 1-3.2 1.8"/></>,
  commit: <><circle className="icon-fill" cx="12" cy="12" r="3.5"/><path d="M3 12h5.5m7 0H21"/></>,
  // Source control, after an editor's: discard, a remote branch, fetch, pull and push.
  cloud: <path className="icon-fill" d="M7.25 19a4.25 4.25 0 0 1-.6-8.46 5.75 5.75 0 0 1 11.1-.9A4.75 4.75 0 0 1 17 19Z"/>,
  fetch: <><circle cx="12" cy="19" r="2.25"/><path d="M12 3.5V5m0 3v1.5m0 3V14m-3.5-3.25L12 14.25l3.5-3.5"/></>,
  pull: <><circle cx="12" cy="19" r="2.25"/><path d="M12 3.5v10.75m-3.5-3.5 3.5 3.5 3.5-3.5"/></>,
  push: <><circle cx="12" cy="19" r="2.25"/><path d="M12 16.75V3.75M8.5 7.25l3.5-3.5 3.5 3.5"/></>,
  notes: <><path className="icon-fill" d={bubble}/><path d="M8 9h8m-8 3.75h5"/></>,
  // The PDF tool rail: pointer, pencil with the pen's colour line, magic
  // wand, dashed region, sticky note, strikethrough and hand.
  toolSelect: <path className="icon-fill" d="M6 3.75v14.6c0 .5.6.75.95.4l3.2-3.15 2.2 5.05c.17.38.6.55.98.39l1.8-.78a.75.75 0 0 0 .38-.98l-2.2-5h4.6c.5 0 .76-.6.4-.95L7.05 3.4A.6.6 0 0 0 6 3.75Z"/>,
  toolNote: <><path className="icon-fill" d="M15.4 3.75a2.2 2.2 0 0 1 3.1 0l.75.75a2.2 2.2 0 0 1 0 3.1L8.7 18.15l-4.7 1.35 1.35-4.7Z"/><path d="m13.6 5.55 3.85 3.85"/><rect className="tool-note-line" x="12" y="19.4" width="9" height="1.6" rx=".8" fill="currentColor" stroke="none"/></>,
  toolMagic: <><path d="m4 20 9.25-9.25"/><path className="icon-fill" d="m13.25 10.75 1.6-1.6a1.4 1.4 0 0 1 2 2l-1.6 1.6Z"/><path fill="currentColor" stroke="none" d={`${star(17.5, 5, 2.6)}${star(10.25, 4.75, 1.6)}${star(19.5, 13.75, 1.6)}`}/></>,
  toolRegion: <path d="M3.5 7v-.5a3 3 0 0 1 3-3H7m3.25 0h3.5M17 3.5h.5a3 3 0 0 1 3 3V7m0 3.25v3.5M20.5 17v.5a3 3 0 0 1-3 3H17m-3.25 0h-3.5M7 20.5h-.5a3 3 0 0 1-3-3V17m0-3.25v-3.5"/>,
  toolSticky: <><path className="icon-fill" d="M15 20.5H6.5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3V15Z"/><path d="M15 20.5V16a1 1 0 0 1 1-1h4.5"/></>,
  toolStrike: <path d="M16.4 7.4C15.8 5.5 14.1 4.25 11.9 4.25c-2.55 0-4.45 1.5-4.45 3.55 0 1.5.9 2.5 2.7 3.2M4 12h16m-5.15 1.75c.85.65 1.35 1.5 1.35 2.6 0 2.1-1.95 3.4-4.4 3.4-2.45 0-4.25-1.25-4.75-3.1"/>,
  toolHand: <path className="icon-fill" d="M8 13.75V6.6a1.5 1.5 0 0 1 3 0v4.9V4.85a1.5 1.5 0 0 1 3 0v6.65V6.1a1.5 1.5 0 0 1 3 0v5.9-3.4a1.5 1.5 0 0 1 3 0v6a6.4 6.4 0 0 1-6.4 6.4h-1.1a6.4 6.4 0 0 1-5.15-2.6L4.1 14.4a1.55 1.55 0 0 1 2.35-2Z"/>,
  // Quick notes for the magic pen.
  sparkles: <><path className="icon-fill" d={star(10, 12, 7)}/><path fill="currentColor" stroke="none" d={`${star(18.25, 5.25, 2.5)}${star(18.5, 17.5, 2.25)}`}/></>,
  runt: <path d="M3.5 5.5h17m-17 4.5h17m-17 4.5H12M3.5 19h3m4 0h6a3 3 0 0 0 3-3v-2.5m-2.25 2.25 2.25-2.25 2.25 2.25"/>,
  verify: <>{lens}<path d="m7.75 10.75 1.9 1.9 3.6-3.65"/></>,
  lineBreak: <path d="M19.5 4.5V11a4 4 0 0 1-4 4h-11m4-4-4 4 4 4"/>,
  expand: <path d="M4 4.5h16M4 19.5h16M9.5 12H3m2.75-2.75L3 12l2.75 2.75M14.5 12H21m-2.75-2.75L21 12l-2.75 2.75"/>,
  question: <>{ring}<path d="M9.5 9.6a2.6 2.6 0 0 1 5.1.7c0 1.75-2.6 2.15-2.6 3.85"/>{dot(12, 16.9)}</>,
  flag: <><path d="M5 21V4.5"/><path className="icon-fill" d="M5 4.5c2.5-1.3 4.7-1.3 7 0s4.5 1.3 7 0v9c-2.5 1.3-4.7 1.3-7 0s-4.5-1.3-7 0Z"/></>,
  pen: <><path className="icon-fill" d="m12 2.75 5.9 6.6-1.8 7.4H7.9L6.1 9.35Z"/><path d="M12 2.75v7.5M8.5 20.5h7"/>{dot(12, 12.25, 1.35)}</>,
  copy: <><rect className="icon-fill" x="8.5" y="8.5" width="12" height="12" rx="3"/><path d="M15.5 8.5v-2a3 3 0 0 0-3-3h-6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2"/></>,
  bookmark: <path className="icon-fill" d="M8.5 3h7A2.5 2.5 0 0 1 18 5.5v14.65c0 .6-.68.94-1.17.58L12 17l-4.83 3.73A.73.73 0 0 1 6 20.15V5.5A2.5 2.5 0 0 1 8.5 3Z"/>,
  bookmarkFilled: <path d="M8.5 3h7A2.5 2.5 0 0 1 18 5.5v14.65c0 .6-.68.94-1.17.58L12 17l-4.83 3.73A.73.73 0 0 1 6 20.15V5.5A2.5 2.5 0 0 1 8.5 3Z" fill="currentColor"/>,
  plane: <path className="icon-fill" d="M20.3 3.65 3.95 10.2a.8.8 0 0 0 .03 1.5l6.52 2.3 2.3 6.52a.8.8 0 0 0 1.5.03L20.85 4.2a.42.42 0 0 0-.55-.55ZM10.5 14 20.4 3.6"/>,
  spark: <><path className="icon-fill" d={star(11, 12, 7.5)}/><path fill="currentColor" stroke="none" d={star(19, 18.25, 2.4)}/></>,
  spellcheck: <path d="m3 16.5 4-11 4 11m-6.5-3.75h5m4.5 3.5 2.75 2.75L21.5 13"/>,
  compress: <path d="M4 4.5h16M4 19.5h16M2.5 12H9M6.25 9.25 9 12l-2.75 2.75M21.5 12H15m2.75-2.75L15 12l2.75 2.75"/>,
  sigma: <path d="M18 6.75V4H6l6.5 8L6 20h12v-2.75"/>,
  checklist: <path d="m3 6 1.75 1.75L8 4.5M3 12.25 4.75 14 8 10.75M3 18.5l1.75 1.75L8 17m3.5-10.5h9m-9 6h9m-9 6h9"/>,
  book: <path className="icon-fill" d="M12 6.5C10.2 4.9 7.4 4.1 3.5 4.25V18c3.9-.15 6.7.65 8.5 2.25 1.8-1.6 4.6-2.4 8.5-2.25V4.25C16.6 4.1 13.8 4.9 12 6.5Zm0 0v13.75"/>,
  chart: <><rect className="icon-fill" x="3.75" y="12" width="4" height="8.25" rx="1.25"/><rect className="icon-fill" x="10" y="7.25" width="4" height="13" rx="1.25"/><rect className="icon-fill" x="16.25" y="3.75" width="4" height="16.5" rx="1.25"/></>,
  globe: <>{ring}<ellipse cx="12" cy="12" rx="3.9" ry="9"/><path d="M3 12h18M4.6 7.5c4.6 1 10.2 1 14.8 0M4.6 16.5c4.6-1 10.2-1 14.8 0"/></>,
  lightbulb: <><path className="icon-fill" d="M9.25 17c0-1.2-.4-2.3-1.3-3.2a6 6 0 1 1 8.1 0c-.9.9-1.3 2-1.3 3.2Z"/><path d="M9.75 20.5h4.5"/></>,
  link: <path d="M10.5 13.5a3.54 3.54 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1 1m1 3a3.54 3.54 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1-1"/>,
  quote: <><circle className="icon-fill" cx="7" cy="9.75" r="3"/><circle className="icon-fill" cx="16.5" cy="9.75" r="3"/><path d="M10 9.75c0 4-2 6.9-5.5 8.5m15-8.5c0 4-2 6.9-5.5 8.5"/></>,
  library: <><rect className="icon-fill" x="3.5" y="4" width="4.25" height="16.25" rx="1.25"/><rect className="icon-fill" x="7.75" y="4" width="4.25" height="16.25" rx="1.25"/><path className="icon-fill" d="m14.55 5.7 2.9-.8a1 1 0 0 1 1.22.7l3.38 12.55a1 1 0 0 1-.7 1.22l-2.9.8a1 1 0 0 1-1.22-.7L13.85 6.92a1 1 0 0 1 .7-1.22Z"/></>,
  languages: <path d="M3.5 5.5h10m-5-2v2m3 0c0 5.5-3 8.5-8 10.5m2-7c1 2.7 3 4.7 6.5 6.5m1 5.5 4-10.5 4 10.5m-6.5-3.5h5"/>,
  heading: <path d="M6.5 4.5v15m11-15v15m-11-7.5h11M4 4.5h5m6 0h5M4 19.5h5m6 0h5"/>,
  highlighter: <><path className="icon-fill" d="m14.75 3.5 5.75 5.75-8.25 8.25-5.75-5.75Z"/><path d="m6.5 11.75-2.25 6 1.5 1.5 6-2.25M3.5 20.5h5"/></>,
  table: <><rect className="icon-fill" x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9.5h18M3 14.75h18M9 9.5V20m6-10.5V20"/></>,
  image: <><rect className="icon-fill" x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.75"/><path d="m3.5 17.5 4.6-4.6a1.5 1.5 0 0 1 2.1 0l5.3 5.3M14 15.5l1.6-1.6a1.5 1.5 0 0 1 2.1 0l2.8 2.8"/></>,
  presentation: <><path className="icon-fill" d="M4.5 4h15v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2Z"/><path d="M3 4h18m-9 12v4m-3.5.5h7M8 12l2.5-2.5 2 2L16 8"/></>,
  diagram: <><rect className="icon-fill" x="8" y="3" width="8" height="5.5" rx="1.75"/><rect className="icon-fill" x="2.5" y="15.5" width="8" height="5.5" rx="1.75"/><rect className="icon-fill" x="13.5" y="15.5" width="8" height="5.5" rx="1.75"/><path d="M12 8.5V12m-5.5 3.5V12h11v3.5"/></>,
  database: <><ellipse className="icon-fill" cx="12" cy="6" rx="7.5" ry="2.75"/><path d="M4.5 6v12c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75V6m-15 6c0 1.5 3.4 2.75 7.5 2.75s7.5-1.25 7.5-2.75"/></>,
  calculator: <><rect className="icon-fill" x="5" y="2.75" width="14" height="18.5" rx="3"/><path d="M8.5 6.75h7"/>{[11, 14.25, 17.5].map(y => <g key={y}>{dot(8.75, y, 1)}{dot(12, y, 1)}{dot(15.25, y, 1)}</g>)}</>,
  ruler: <><path className="icon-fill" d="M3.4 15.4 15.4 3.4a1.4 1.4 0 0 1 2 0l3.2 3.2a1.4 1.4 0 0 1 0 2L8.6 20.6a1.4 1.4 0 0 1-2 0l-3.2-3.2a1.4 1.4 0 0 1 0-2Z"/><path d="m7 12 1.75 1.75M10 9l1.75 1.75M13 6l1.75 1.75"/></>,
  target: <>{ring}<circle className="icon-fill" cx="12" cy="12" r="5.25"/>{dot(12, 12, 1.6)}</>,
  flask: <><path className="icon-fill" d="M10.25 3.5v5.25L5 17.6a2 2 0 0 0 1.7 3.15h10.6a2 2 0 0 0 1.7-3.15l-5.25-8.85V3.5"/><path d="M9.25 3.5h5.5M7.4 14.5h9.2"/></>,
  atom: <><ellipse cx="12" cy="12" rx="9.5" ry="3.75"/><ellipse cx="12" cy="12" rx="9.5" ry="3.75" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.75" transform="rotate(120 12 12)"/>{dot(12, 12, 1.4)}</>,
  dna: <path d="M7 2.75c0 9.25 10 9.25 10 18.5m0-18.5c0 9.25-10 9.25-10 18.5M7.75 5.75h8.5M9.75 9.25h4.5m-4.5 5.5h4.5m-6.5 3.5h8.5"/>,
  microscope: <><path className="icon-fill" d="m8.25 3.3 3.2-.85a.8.8 0 0 1 .98.56l2.1 7.75a.8.8 0 0 1-.56.98l-3.2.85a.8.8 0 0 1-.98-.56l-2.1-7.75a.8.8 0 0 1 .56-.98Z"/><path d="m10.75 12.6.6 2.4M4 17.25h9M3.5 20.75h17m-8.5 0V17.25m3.75-10.5a7 7 0 0 1 .25 14"/></>,
  brain: <><path d="M12 5.25a3 3 0 0 0-5.85-.9A4 4 0 0 0 3.4 10a4 4 0 0 0 .1 6 4 4 0 0 0 5.75 3.85A3 3 0 0 0 12 18Zm0 0a3 3 0 0 1 5.85-.9A4 4 0 0 1 20.6 10a4 4 0 0 1-.1 6 4 4 0 0 1-5.75 3.85A3 3 0 0 1 12 18V5.25"/><path d="M3.5 10.25h2.75l1.75 1.75m12.5-1.75h-2.75L16 12M6.5 16l2.75.75m8.25-.75-2.75.75"/></>,
  network: <><circle className="icon-fill" cx="12" cy="12" r="3"/><circle cx="4.5" cy="4.5" r="2"/><circle cx="19.5" cy="4.5" r="2"/><circle cx="4.5" cy="19.5" r="2"/><circle cx="19.5" cy="19.5" r="2"/><path d="m5.9 5.9 4 4m4.2 4.2 4 4m0-12.2-4 4m-4.2 4.2-4 4"/></>,
  shield: <><path className="icon-fill" d="m12 2.75 7.25 2.75v5.75c0 4.6-3 8.3-7.25 10-4.25-1.7-7.25-5.4-7.25-10V5.5Z"/><path d="m8.75 12 2.25 2.25 4.25-4.5"/></>,
  scale: <path d="M12 3.5v17M8 20.5h8M4.5 7 12 5.25 19.5 7M4.5 7l-3 7.5h6Zm15 0-3 7.5h6ZM1.5 14.5a3 3 0 0 0 6 0m9 0a3 3 0 0 0 6 0"/>,
  graduation: <><path className="icon-fill" d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5.5c3.8 2.9 8.2 2.9 12 0V11M22 9v6.5"/></>,
  calendar: <><rect className="icon-fill" x="3" y="4.5" width="18" height="16.25" rx="3.5"/><path d="M3 9.5h18M8 2.75v3.5m8-3.5v3.5"/>{dot(8, 13.25, 1)}{dot(12, 13.25, 1)}{dot(16, 13.25, 1)}{dot(8, 16.75, 1)}{dot(12, 16.75, 1)}</>,
  clock: <><circle className="icon-fill" cx="12" cy="12" r="9"/><path d="M12 7v5l3.25 2"/></>,
  tag: <><path className="icon-fill" d="M3.5 5.5v5.17a2 2 0 0 0 .59 1.42l8.3 8.3a2 2 0 0 0 2.82 0l5.18-5.18a2 2 0 0 0 0-2.82l-8.3-8.3a2 2 0 0 0-1.42-.59H5.5a2 2 0 0 0-2 2Z"/><circle cx="8" cy="8" r="1.5"/></>,
  layers: <><path className="icon-fill" d="m12 3 9.5 4.75L12 12.5 2.5 7.75Z"/><path d="m2.5 12 9.5 4.75L21.5 12m-19 4.25L12 21l9.5-4.75"/></>,
  workflow: <><rect className="icon-fill" x="3" y="3" width="6.5" height="6.5" rx="1.75"/><rect className="icon-fill" x="14.5" y="14.5" width="6.5" height="6.5" rx="1.75"/><path d="M9.5 6.25h6.25a2 2 0 0 1 2 2v4m-2.5-2.5 2.5 2.5 2.5-2.5M6.25 9.5v8.25h5.25"/></>,
  monitor: <><rect className="icon-fill" x="2.5" y="3.5" width="19" height="13" rx="3"/><path d="M12 16.5v4m-4 0h8"/></>,
  bell: <><path className="icon-fill" d="M12 3.25A5.75 5.75 0 0 0 6.25 9v3.6c0 .9-.3 1.8-.9 2.5l-.85 1.05c-.5.6-.07 1.55.72 1.55h13.56c.79 0 1.22-.95.72-1.55l-.85-1.05a3.9 3.9 0 0 1-.9-2.5V9A5.75 5.75 0 0 0 12 3.25Z"/><path d="M9.75 20.25a2.4 2.4 0 0 0 4.5 0"/></>,
  key: <><circle className="icon-fill" cx="7.75" cy="16.25" r="4.25"/><path d="m10.75 13.25 8.75-8.75M16.5 7.5l2.5 2.5M14 10l2 2"/></>,
  people: <><circle className="icon-fill" cx="9" cy="8" r="3.5"/><path d="M2.75 20a6.25 6.25 0 0 1 12.5 0M15.75 4.75a3.4 3.4 0 0 1 0 6.5M18.25 14.25A6.3 6.3 0 0 1 21.25 20"/></>,
  settings: <><path className="icon-fill" d="M9.83 5.13 10.07 2.9a9.3 9.3 0 0 1 3.86 0l.24 2.23a7.2 7.2 0 0 1 1.15.48l1.75-1.41a9.3 9.3 0 0 1 2.73 2.73l-1.41 1.75a7.2 7.2 0 0 1 .48 1.15l2.23.24a9.3 9.3 0 0 1 0 3.86l-2.23.24a7.2 7.2 0 0 1-.48 1.15l1.41 1.75a9.3 9.3 0 0 1-2.73 2.73l-1.75-1.41a7.2 7.2 0 0 1-1.15.48l-.24 2.23a9.3 9.3 0 0 1-3.86 0l-.24-2.23a7.2 7.2 0 0 1-1.15-.48L6.93 19.8a9.3 9.3 0 0 1-2.73-2.73l1.41-1.75a7.2 7.2 0 0 1-.48-1.15l-2.23-.24a9.3 9.3 0 0 1 0-3.86l2.23-.24a7.2 7.2 0 0 1 .48-1.15L4.2 6.93A9.3 9.3 0 0 1 6.93 4.2l1.75 1.41a7.2 7.2 0 0 1 1.15-.48Z"/><circle cx="12" cy="12" r="3"/></>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.paper}</svg>;
}
