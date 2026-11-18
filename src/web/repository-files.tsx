import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RepositoryFile, RepositoryFiles } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { browserStorage } from './storage.ts';
import './repository-files.css';

// The paper's repository, from the Manuscript row of the sidebar: any text
// file opens in the source editor, and any root document, such as a thesis,
// its slides or a response letter, can be the one the manuscript compiles.

type Api = <T>(route: string, body?: unknown) => Promise<T>;
// The source editor edits text; these open nowhere.
const BINARY = /\.(?:png|jpe?g|gif|bmp|tiff?|webp|heic|ico|pdf|eps|ps|svgz|zip|gz|tgz|bz2|xz|7z|tar|ttf|otf|woff2?|mp[34]|mov|wav|docx?|xlsx?|pptx?|odt)$/i;
const IMAGE = /\.(?:png|jpe?g|gif|bmp|tiff?|webp|heic|ico|svg|eps|pdf)$/i;

interface Folder { name: string; path: string; folders: Folder[]; files: (RepositoryFile & { name: string })[] }
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
function tree(files: RepositoryFile[]): Folder {
  const top: Folder = { name: '', path: '', folders: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let folder = top;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let next = folder.folders.find(item => item.name === part);
      if (!next) folder.folders.push(next = { name: part, path, folders: [], files: [] });
      folder = next;
    }
    folder.files.push({ ...file, name: parts.at(-1)! });
  }
  const sort = (folder: Folder) => { folder.folders.sort(byName); folder.files.sort(byName); folder.folders.forEach(sort); };
  sort(top);
  return top;
}
const ancestors = (file: string | null) => file ? file.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/')) : [];

/** The paper's files and the root document it compiles. They are read once
 *  for the menu's name, then again only while the menu is open: when it
 *  opens after `version` changed, such as with a new working tree, when
 *  `version` changes meanwhile, and when the window comes back. */
function useRepositoryFiles(api: Api, projectId: string, version: unknown, open: boolean) {
  const [value, setValue] = useState<RepositoryFiles | null>(null), [error, setError] = useState<string | null>(null);
  const request = useRef(0), read = useRef<unknown>(undefined);
  const load = useCallback(async () => {
    const id = ++request.current;
    read.current = version;
    try {
      const files = await api<RepositoryFiles>(`/projects/${projectId}/files`);
      if (id !== request.current || !Array.isArray(files?.files)) return;
      setValue({ document: typeof files.document === 'string' ? files.document : null, files: files.files.filter(file => typeof file?.path === 'string') });
      setError(null);
    } catch (failure) {
      // The menu keeps the last list it had; without one it says why.
      if (id === request.current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [api, projectId, version]);
  useEffect(() => { if (read.current === undefined || (open && read.current !== version)) void load(); }, [load, open, version]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load, open]);
  return { files: value, error: value ? null : error, reload: load };
}

export function RepositoryFilesMenu({ api, projectId, version, shownDocument, editing, onOpen, onCompile }: {
  api: Api; projectId: string;
  /** Changes when the list may have: the working tree, or the document compiled. */
  version: string;
  /** The root document of the PDF on screen, when it is known. */
  shownDocument?: string;
  /** The file open in the source editor. */
  editing: string | null;
  onOpen: (file: string) => void;
  onCompile: (file: string) => Promise<void>;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLUListElement>(null);
  const [shown, setShown] = useState(false);
  const { files, error, reload } = useRepositoryFiles(api, projectId, version, shown);
  // Open folders, per paper (the menu is keyed by it); at first those
  // leading to the compiled document.
  const openKey = `papilot:files-open:${projectId}`;
  const [open, setOpen] = useState<Set<string> | null>(() => {
    try {
      const saved: unknown = JSON.parse(browserStorage.getItem(openKey) || 'null');
      return Array.isArray(saved) ? new Set(saved.filter(item => typeof item === 'string')) : null;
    } catch { return null; }
  });
  const document = files?.document ?? null;
  const folders = open ?? new Set(ancestors(document));
  const toggle = (path: string) => {
    const next = new Set(folders);
    if (!next.delete(path)) next.add(path);
    setOpen(next); browserStorage.setItem(openKey, JSON.stringify([...next]));
  };
  // The open file's folders open with it.
  useEffect(() => {
    if (!editing || ancestors(editing).every(path => folders.has(path))) return;
    const next = new Set([...folders, ...ancestors(editing)]);
    setOpen(next); browserStorage.setItem(openKey, JSON.stringify([...next]));
  }, [editing]);
  const root = useMemo(() => files ? tree(files.files) : null, [files]);
  const [switching, setSwitching] = useState<string | null>(null);
  // The browser returns focus to the trigger when focus was in the list.
  const close = () => panel.current?.hidePopover();
  async function compile(file: string) {
    if (switching) return;
    setSwitching(file);
    try { await onCompile(file); await reload(); close(); } finally { setSwitching(null); }
  }
  useEffect(() => {
    if (!shown) return;
    const dismiss = () => close();
    window.addEventListener('resize', dismiss);
    return () => window.removeEventListener('resize', dismiss);
  }, [shown]);
  // Beside the sidebar, as Research Tools opens, level with the Manuscript row.
  function show() {
    const element = panel.current!, box = (trigger.current!.closest('.manuscript-row') || trigger.current!).getBoundingClientRect();
    element.style.maxHeight = '';
    element.showPopover();
    if (!window.matchMedia('(max-width: 680px)').matches) {
      const right = box.right + 6, left = box.left - element.offsetWidth - 6;
      element.style.left = `${right + element.offsetWidth <= window.innerWidth - 8 || left < 8 ? Math.max(8, Math.min(right, window.innerWidth - element.offsetWidth - 8)) : left}px`;
      const top = Math.max(8, Math.min(box.top - 5, window.innerHeight - element.offsetHeight - 8));
      // Folders opened later grow it down to the window's edge, then it scrolls.
      element.style.top = `${top}px`; element.style.maxHeight = `${window.innerHeight - top - 8}px`;
    } else { element.style.left = ''; element.style.top = ''; }
    // Focus starts on the file being edited, else the compiled document.
    (element.querySelector<HTMLElement>('.repo-entry[aria-current="true"]') || element.querySelector<HTMLElement>('.repo-row.current>.repo-entry') || element.querySelector<HTMLElement>('.repo-entry'))?.focus();
  }

  const rows = (folder: Folder, depth: number): React.ReactNode[] => [
    ...folder.folders.map(child => {
      const expanded = folders.has(child.path);
      return <li key={'d:' + child.path} className="repo-row folder" style={{ '--depth': depth } as React.CSSProperties}>
        <button type="button" className="repo-entry" aria-expanded={expanded} title={child.path} onClick={() => toggle(child.path)}>
          <Icon name="chevronRight" size={12}/><Icon name="folder" size={14}/><span className="repo-name">{child.name}</span>
        </button>
        {expanded && <ul role="group">{rows(child, depth + 1)}</ul>}
      </li>;
    }),
    ...folder.files.map(file => {
      const current = file.path === document, binary = BINARY.test(file.path);
      return <li key={'f:' + file.path} className={'repo-row file' + (current ? ' current' : '') + (file.path === editing ? ' editing' : '')} style={{ '--depth': depth } as React.CSSProperties}>
        <button type="button" className="repo-entry" disabled={binary} aria-current={file.path === editing ? 'true' : undefined} title={file.path} onClick={() => { close(); onOpen(file.path); }}>
          <Icon name={file.root ? 'pdf' : IMAGE.test(file.path) ? 'image' : 'paper'} size={14}/><span className="repo-name">{file.name}</span>
        </button>
        {file.root && (current
          ? <span className="repo-state" role="img" aria-label={t('Compiled document')} title={t('Compiled document')}><Icon name="check" size={13}/></span>
          : switching === file.path ? <span className="repo-state"><span className="spinner" role="status" aria-label={t('Compiling the PDF…')}/></span>
          : <button type="button" className="icon-button repo-compile" disabled={Boolean(switching)} aria-label={t('Compile {name}', { name: file.name })} title={t('Compile this document')} onClick={() => void compile(file.path)}><Icon name="compile" size={12}/></button>)}
      </li>;
    }),
  ];

  // The trigger names the document of the PDF on screen, else the one the
  // paper compiles; the menu lists every file.
  const named = shownDocument ?? document, name = named ? named.slice(named.lastIndexOf('/') + 1) : '';
  const label = name ? `${t('Files')} · ${name}` : t('Files');
  // A dropdown list, not a dialog: the popover dismisses itself on Escape or
  // a click elsewhere. Escape stops here so the sidebar's own does not run.
  return <span className="menu-anchor repo-files-anchor">
    <button ref={trigger} type="button" className="repo-files-trigger" aria-label={label} title={named ? `${t('Files')} · ${named}` : label} aria-expanded={shown} aria-controls={id}
      popoverTarget={id} onClick={event => { event.preventDefault(); if (panel.current?.matches(':popover-open')) close(); else show(); }}>
      {name ? <span className="repo-files-name">{name}</span> : <Icon name="folder" size={14}/>}<Icon name="chevronDown" size={12}/>
    </button>
    <ul ref={panel} id={id} popover="auto" role="list" aria-label={t('Repository files')} className="repo-files-panel"
      onToggle={event => setShown((event.nativeEvent as ToggleEvent).newState === 'open')}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
      {root ? rows(root, 0)
        : error ? <li className="repo-files-error"><span role="alert">{error}</span><button type="button" className="note-link" onClick={() => void reload()}>{t('Retry')}</button></li>
        : <li><span className="spinner" role="status" aria-label={t('Loading files…')}/></li>}
    </ul>
  </span>;
}
