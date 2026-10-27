const paths: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14"/>,
  compose: <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></>,
  sidebar: <><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  arrowUp: <path d="M12 19V5m-7 7 7-7 7 7"/>,
  arrowDown: <path d="M12 5v14m7-7-7 7-7-7"/>,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/>,
  updown: <path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>,
  check: <path d="M20 6 9 17l-5-5"/>,
  close: <path d="M18 6 6 18M6 6l12 12"/>,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></>,
  external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
  paper: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5M16 13H8M16 17H8M10 9H8"/></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>,
  split: <><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M14 3v18"/></>,
  terminal: <path d="m4 17 6-6-6-6m8 14h8"/>,
  diff: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6m-3-3v6m-3 4h6"/></>,
  tool: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></>,
  trash: <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6"/>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
  pencil: <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  plane: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.paper}</svg>;
}
