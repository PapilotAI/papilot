import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { PdfView, type PdfHandle, type OutlineItem } from '../../../src/web/pdf-view.tsx';
import { connectStamps } from '../../../src/web/stamps.ts';
import { t } from '../../../src/web/i18n.ts';
import type { Manuscript, SourcePlace } from '../../../src/shared.ts';
import { api, call, command, ready, useHost } from './bridge.ts';
import '../../../src/web/style.css';
import '../../../src/web/note-controls.css';
import './style.css';
connectStamps(api);
function Paper() {
  const data = useHost<{ manuscript?: Manuscript; error?: string; pdf?: string; place?: { place: SourcePlace; at: number }; view: { paper: { project: { id: string }; document: string; key: string } } }>();
  const pdf = useRef<PdfHandle>(null);
  const shownPlace = useRef(0);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [region, setRegion] = useState(false), [outline, setOutline] = useState<OutlineItem[]>([]), [section, setSection] = useState(-1), [active, setActive] = useState(''), [error, setError] = useState('');
  const report = (error: unknown) => setError(error instanceof Error ? error.message : String(error));
  useEffect(() => {
    if (data?.place && data.pdf && pdf.current && shownPlace.current !== data.place.at) {
      pdf.current.showPlace(data.place.place.page, data.place.place.rect); shownPlace.current = data.place.at;
    }
  }, [data?.place, data?.pdf, outline]);
  if (!data) return <p className="empty" role="status">{t('Loading PDF review…')}</p>;
  if (!data.manuscript) return <p className="host-error" role="alert">{data.error || t('Unavailable')}</p>;
  const { manuscript, view } = data, key = manuscript.build.key, base = `/projects/${view.paper.project.id}`;
  const errors = manuscript.build.problems?.errors || 0, warnings = manuscript.build.problems?.warnings || 0;
  return <main className="paper-host"><header className="host-toolbar"><button onClick={() => void command('papilot.build').catch(report)}>{t('Compile this document')}</button><button onClick={() => void command('papilot.newTask', { notes: selectedNotes.length ? selectedNotes : undefined }).catch(report)}>{t('New task')}</button><button onClick={() => void command('papilot.changes').catch(report)}>{t('Changes')}</button><button onClick={() => void command('papilot.log').catch(report)}>{t('Compilation log')}</button><span role="status">{manuscript.build.status === 'building' ? t('Compiling the PDF…') : `${t('{n} compilation errors', { n: errors })} · ${t('{n} compilation warnings', { n: warnings })}`}</span></header>
    {(error || manuscript.build.error) && <p className="host-error" role="alert">{error || manuscript.build.error}</p>}
    {data.pdf ? <PdfView ref={pdf} url={data.pdf} pdfKey={key} keyedNotes words={`/api${base}/manuscript/words?key=${encodeURIComponent(key!)}`} notes={manuscript.annotations.map((note, number) => ({ note, number: number + 1 }))} active={active} region={region} setRegion={setRegion} outline={outline} section={section} onOutline={setOutline} onSection={setSection} place={view.paper.key}
      noteActions={{ has: id => selectedNotes.includes(id), toggle: note => setSelectedNotes(ids => ids.includes(note.id) ? ids.filter(id => id !== note.id) : [...ids, note.id]),
        remove: async note => { await api(`${base}/annotations/${note.id}/delete`, {}); await ready(); },
        restore: async note => { await api(`${base}/annotations/${note.id}/restore`, {}); await ready(); },
        edit: async (note, comment) => { await api(`${base}/annotations/${note.id}`, { comment }); await ready(); },
        regroup: async (note, group) => { await api(`${base}/annotations/${note.id}`, { group }); await ready(); }, onEditing: () => undefined, onBusy: () => undefined, disabled: false }}
      onSelect={note => setActive(note.id)} onDeselect={() => setActive('')}
      anchorApi={(action, body) => api(`${base}/manuscript/anchors${action === 'resolve' ? '/resolve' : ''}`, body)}
      onCreate={async (page, rect, rects, quote, comment, group, options) => { await api(`${base}/annotations`, { key: options?.key || key, page, rect, rects, quote, comment, group, kind: options?.kind, stamp: options?.stamp }); await ready(); }}
      onSource={(target, sourceKey) => void call('source', { target: { ...target, key: sourceKey || key } }).catch(report)}/>
      : <p className="empty" role="status">{manuscript.build.status === 'failed' ? t('Compilation problems') : t('Compiling the PDF…')}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Paper/>);
void ready();
