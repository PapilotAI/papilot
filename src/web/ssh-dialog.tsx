import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SshDocument, SshEntry, SshFolder, SshFolderPreview } from '../shared.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import { SourceCodeEditor } from './source-codemirror.ts';
import './ssh-dialog.css';

type Api = <T>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
type OpenFile = SshDocument & { path: string };
type Connections = { folders: SshFolder[]; aliases: string[] };
const blank = { host: '', user: '', port: '', identity: '' };
const label = (folder: SshFolder) => (folder.user ? folder.user + '@' : '') + folder.host + (folder.port ? ':' + folder.port : '');

export default function SshDialog({ api, onClose }: { api: Api; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId();
  const [connections, setConnections] = useState<Connections>({ folders: [], aliases: [] });
  const [choice, setChoice] = useState('manual'), [form, setForm] = useState(blank);
  const [picker, setPicker] = useState<SshFolderPreview | null>(null);
  const [jumpPath, setJumpPath] = useState('/');
  const location = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => { if (picker?.pages) location.current?.focus(); }, [picker]);
  const [folder, setFolder] = useState<SshFolder | null>(null);
  const [directory, setDirectory] = useState(''), [entries, setEntries] = useState<SshEntry[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), editorHost = useRef<HTMLDivElement>(null), editor = useRef<SourceCodeEditor | null>(null);
  const baseline = useRef<SshDocument | null>(null);
  const saveAction = useRef(() => {}); saveAction.current = () => void save();

  useEffect(() => {
    const element = dialog.current!, controller = new AbortController();
    element.showModal();
    void api<Connections>('/ssh', undefined, controller.signal).then(setConnections, failure => {
      if (!controller.signal.aborted) setError(String(failure.message || failure));
    });
    return () => { controller.abort(); element.close(); };
  }, [api]);

  useLayoutEffect(() => {
    if (!file || !editorHost.current) return;
    baseline.current = file;
    const view = new SourceCodeEditor({
      parent: editorHost.current, label: file.path, onSave: () => saveAction.current(), onEscape: () => false,
      onChange: () => setDirty(view.text !== baseline.current?.text),
    });
    editor.current = view;
    view.load(file.text, file.text);
    view.focus();
    return () => { view.destroy(); editor.current = null; baseline.current = null; };
  }, [file]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function run(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); editor.current?.setReadOnly(true);
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pending.current = false; setBusy(false); editor.current?.setReadOnly(false); }
  }
  function canLeave() {
    return !pending.current && (!dirty || window.confirm(t('Discard changes in {name}?', { name: file?.path ?? '' })));
  }
  function close() {
    if (canLeave()) { dialog.current?.close(); onClose(); }
  }
  function select(value: string) {
    setChoice(value); setError('');
    const saved = connections.folders.find(item => item.id === value);
    setForm(saved ? { host: saved.host, user: saved.user || '', port: saved.port?.toString() || '', identity: saved.identity || '' }
      : { ...blank, host: value.startsWith('config:') ? value.slice(7) : '' });
  }
  function target(root: string) {
    return { host: form.host.trim(), root, user: form.user.trim() || undefined,
      port: form.port ? Number(form.port) : undefined, identity: form.identity.trim() || undefined };
  }
  function chooseFolder(root: string, canonical = true, page = 0) {
    return run(async () => {
      const preview = await api<SshFolderPreview>('/ssh/browse', { ...target(root), canonical, page });
      setPicker(preview); setJumpPath(preview.root);
    });
  }
  function previewRoot() {
    setPicker({ root: '/', entries: [], page: 0, pages: 0 });
    setJumpPath('/');
    return chooseFolder('/');
  }
  function connect(root: string) {
    return run(async () => {
      const result = await api<{ folder: SshFolder; entries: SshEntry[] }>('/ssh/connect', target(root));
      setPicker(null); setFolder(result.folder); setDirectory(''); setEntries(result.entries);
      setChoice(result.folder.id);
      setConnections(prev => ({ ...prev, folders: [...prev.folders.filter(f => f.id !== result.folder.id), result.folder] }));
    });
  }
  function forget() {
    return run(async () => {
      await api('/ssh/' + choice + '/forget', {});
      setConnections(prev => ({ ...prev, folders: prev.folders.filter(f => f.id !== choice) }));
      select('manual');
    });
  }
  function browse(path: string) {
    if (!canLeave()) return;
    void run(async () => {
      const result = await api<{ entries: SshEntry[] }>('/ssh/' + folder!.id + '/list', { path });
      setEntries(result.entries); setDirectory(path); setFile(null); setDirty(false);
    });
  }
  function open(path: string) {
    if (!canLeave()) return;
    void run(async () => {
      const document = await api<SshDocument>('/ssh/' + folder!.id + '/read', { path });
      setFile({ ...document, path }); setDirty(false);
    });
  }
  async function save() {
    if (!editor.current || !file || !baseline.current || !folder || editor.current.text === baseline.current.text) return;
    const text = editor.current.text, revision = baseline.current.revision;
    await run(async () => {
      const saved = await api<{ revision: string }>('/ssh/' + folder.id + '/save', { path: file.path, revision, text });
      baseline.current = { revision: saved.revision, text };
      editor.current?.setBase(text); setDirty(false);
    });
  }
  const savedChoice = connections.folders.find(f => f.id === choice);
  const segments = picker?.root.split('/').filter(Boolean) ?? [];
  const trail = ['/', ...segments.map((_, i) => '/' + segments.slice(0, i + 1).join('/'))];
  return <dialog ref={dialog} aria-labelledby={title} className="modal-backdrop ssh-backdrop"
    onCancel={event => { event.preventDefault(); close(); }}>
    <section className={'modal ssh-dialog' + (folder ? ' ssh-open' : '')}>
      <button className="modal-close icon-button" type="button" aria-label={t('Close')} disabled={busy} onClick={close}><Icon name="close"/></button>
      <h2 id={title}><Icon name="terminal" size={16}/>{t('SSH remote folder')}</h2>
      {picker ? <div className="ssh-picker">
        <div className="ssh-toolbar"><button type="button" className="button secondary compact" disabled={busy} onClick={() => { setPicker(null); setError(''); }}><Icon name="chevronLeft" size={15}/>{t('Back')}</button><strong>{form.host}</strong></div>
        <nav className="ssh-trail" aria-label={t('Folder path')}><ol>{trail.map((path, i) =>
          <li key={path}>{i === trail.length - 1
            ? <span ref={location} tabIndex={-1} aria-current="location" dir="auto">{segments[i - 1] ?? '/'}</span>
            : <button type="button" disabled={busy} onClick={() => void chooseFolder(path)} dir="auto">{segments[i - 1] ?? '/'}</button>}</li>)}</ol></nav>
        <div className="ssh-files" key={picker.root + ':' + picker.page} aria-busy={busy}>
          <ul className="ssh-preview-entries" aria-label={t('Folder contents')}>{picker.entries.map(entry => <li key={entry.name}>{entry.folder
            ? <button type="button" className="ssh-entry" disabled={busy} onClick={() => void chooseFolder(picker.root.replace(/\/$/, '') + '/' + entry.name)}><Icon name="folder" size={15}/><span dir="auto">{entry.name}</span></button>
            : <div className="ssh-entry ssh-preview-file"><Icon name="paper" size={15}/><span dir="auto">{entry.name}</span></div>}</li>)}</ul>
          {!picker.entries.length && picker.pages > 0 && <p className="ssh-help">{t('This folder is empty.')}</p>}
        </div>
        {picker.pages > 1 && <div className="ssh-preview-pages">
          <button type="button" className="icon-button" aria-label={t('Previous page')} disabled={busy || picker.page === 0} onClick={() => void chooseFolder(picker.root, true, picker.page - 1)}><Icon name="chevronLeft" size={15}/></button>
          <span>{picker.page + 1} / {picker.pages}</span>
          <button type="button" className="icon-button" aria-label={t('Next page')} disabled={busy || picker.page + 1 === picker.pages} onClick={() => void chooseFolder(picker.root, true, picker.page + 1)}><Icon name="chevronRight" size={15}/></button></div>}
        <details className="ssh-jump" key={picker.root} onToggle={event => { if (!event.currentTarget.open) setJumpPath(picker.root); }}><summary>{t('Go to folder…')}</summary>
          <form onSubmit={event => { event.preventDefault(); void chooseFolder(jumpPath, jumpPath === picker.root); }}>
            <input aria-label={t('Folder path')} required disabled={busy} spellCheck={false} autoCapitalize="none" value={jumpPath} onChange={e => setJumpPath(e.target.value)}/>
            <button className="button secondary compact" disabled={busy}>{t('Open')}</button></form></details>
        <div className="button-row"><button type="button" className="button primary" disabled={busy || !picker.pages || jumpPath !== picker.root} onClick={() => void connect(picker.root)}><Icon name="folder" size={15}/>{t('Use this folder')}</button></div>
        {busy && <span role="status" className="ssh-help">{t('Loading folders…')}</span>}
      </div> : !folder ? <form onSubmit={event => { event.preventDefault(); void (savedChoice ? connect(savedChoice.root) : previewRoot()); }}>
        <label><span id={title + '-connection'}>{t('SSH connection')}</span><select aria-labelledby={title + '-connection'} autoFocus value={choice} disabled={busy} onChange={e => select(e.target.value)}>
          <option value="manual">{t('Manual connection')}</option>
          {!!connections.folders.length && <optgroup label={t('Saved connections')}>{connections.folders.map(f => <option key={f.id} value={f.id}>{label(f)} · {f.root}</option>)}</optgroup>}
          {!!connections.aliases.length && <optgroup label="~/.ssh/config">{connections.aliases.map(h => <option key={h} value={'config:' + h}>{h}</option>)}</optgroup>}
        </select></label>
        {choice === 'manual' && <label>{t('SSH host')}<input required autoCapitalize="none" spellCheck={false} placeholder="server.example.org" value={form.host} disabled={busy} onChange={e => setForm({ ...form, host: e.target.value })}/></label>}
        {!choice.startsWith('config:') && <details className="ssh-options" key={choice} open={choice === 'manual' || undefined}>
          <summary>{t('Connection details')}</summary>
          <div className="ssh-fields">
            <label>{t('SSH user')}<input autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.user} disabled={busy} onChange={e => setForm({ ...form, user: e.target.value })}/></label>
            <label>{t('SSH port')}<input type="number" min="1" max="65535" placeholder="22" value={form.port} disabled={busy} onChange={e => setForm({ ...form, port: e.target.value })}/></label>
            <label>{t('Identity file (optional)')}<input autoCapitalize="none" spellCheck={false} placeholder="~/.ssh/id_ed25519" value={form.identity} disabled={busy} onChange={e => setForm({ ...form, identity: e.target.value })}/></label>
          </div>
        </details>}
        <p className="ssh-help">{t('Verify the host key in a terminal first. Use an SSH key or agent and a Unix server with Python 3.7+.')}</p>
        <div className="button-row">{savedChoice && <button type="button" className="button ghost" disabled={busy} onClick={() => void forget()}>{t('Forget connection')}</button>}
          {savedChoice && <button className="button secondary" type="button" disabled={busy} onClick={() => void previewRoot()}><Icon name="folder" size={15}/>{t('Preview remote folders')}</button>}
          <button className="button primary" type="submit" disabled={busy}>{!savedChoice && <Icon name="folder" size={15}/>}{busy ? t('Connecting…') : savedChoice ? t('Open saved folder') : t('Preview remote folders')}</button></div>
      </form> : <>
        <div className="ssh-toolbar"><button className="button secondary compact" disabled={busy} onClick={() => {
          if (canLeave()) { setFolder(null); setFile(null); setDirty(false); setError(''); select(folder.id); }
        }}><Icon name="chevronLeft" size={15}/>{t('SSH connection')}</button><strong>{label(folder)}</strong></div>
        <div className={'ssh-workspace' + (file ? ' has-file' : '')}>
          <nav className="ssh-files" aria-label={t('Remote folder')}>
            <div className="ssh-location"><button type="button" className="icon-button" aria-label={t('Parent folder')} disabled={!directory || busy} onClick={() => browse(directory.split('/').slice(0, -1).join('/'))}><Icon name="arrowUp" size={14}/></button>
              <span dir="auto">{directory ? folder.root.replace(/\/$/, '') + '/' + directory : folder.root}</span>
              <button className="icon-button" aria-label={t('Refresh')} disabled={busy} onClick={() => browse(directory)}><Icon name="refresh" size={14}/></button></div>
            {entries.map(entry => {
              const path = directory ? directory + '/' + entry.name : entry.name;
              return <button key={entry.name} type="button" className="ssh-entry" disabled={busy} aria-current={file?.path === path || undefined} onClick={() => entry.folder ? browse(path) : open(path)}>
                <Icon name={entry.folder ? 'folder' : 'paper'} size={15}/><span>{entry.name}</span></button>;
            })}
            {!entries.length && <p className="ssh-help">{t('No files found in this folder.')}</p>}
          </nav>
          {file && <div className="source-panel ssh-source"><div className="ssh-file-bar"><strong>{file.path}</strong><span role="status">{dirty ? t('Unsaved changes') : t('Saved')}</span>
            <button className="icon-button" disabled={busy} aria-label={t('Load the current source')} onClick={() => open(file.path)}><Icon name="refresh" size={15}/></button>
            <button className="button primary compact" disabled={busy || !dirty} onClick={() => void save()}>{t('Save')}</button></div><div ref={editorHost} className="ssh-code"/></div>}
        </div>
        {busy && <span role="status" className="ssh-help">{t('Loading…')}</span>}
      </>}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </section>
  </dialog>;
}
