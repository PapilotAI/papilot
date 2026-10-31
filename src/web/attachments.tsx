import { useMemo, useSyncExternalStore } from 'react';
import type { Attachment } from '../shared.ts';
import { AttachmentDraft, attachmentDrafts as drafts, type UploadAttachment } from './attachment-draft.ts';
import { browserStorage } from './storage.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './attachments.css';

export function useAttachmentDraft(key: string) {
  const draft = useMemo(() => {
    let draft = drafts.get(key);
    if (!draft) { draft = new AttachmentDraft(key, browserStorage); drafts.set(key, draft); }
    return draft;
  }, [key]);
  return { draft, ...useSyncExternalStore(draft.subscribe, draft.getSnapshot) };
}
export const attachmentUrl = (file: Attachment) => `/api/projects/${encodeURIComponent(file.projectId)}/attachments/${encodeURIComponent(file.id)}`;
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;

function FileIcon({ file }: { file?: Attachment }) {
  return file?.mime.startsWith('image/') ? <img src={attachmentUrl(file)} alt="" loading="lazy"/> : <Icon name={file?.mime === 'application/pdf' ? 'pdf' : 'paper'} size={20}/>;
}
export function DraftAttachments({ draft, upload, discard, disabled }: { draft: AttachmentDraft; upload: UploadAttachment; discard: (file: Attachment) => void; disabled?: boolean }) {
  const { entries, error } = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  return <>
    {entries.length > 0 && <ul className="composer-attachments" aria-label={t('Attachments')}>{entries.map(entry => <li className={'attachment' + (entry.error ? ' attachment-failed' : '')} key={entry.key}>
      <span className="attachment-icon">{entry.uploading ? <span className="spinner"/> : <FileIcon file={entry.attachment}/>}</span>
      <span className="attachment-info"><span className="attachment-name" title={entry.name}>{entry.name}</span><small title={entry.error} role={entry.uploading ? 'status' : entry.error ? 'alert' : undefined}>{entry.uploading ? t('Uploading…') : entry.error || sizeLabel(entry.size)}</small></span>
      {entry.error && <button type="button" className="icon-button" aria-label={t('Retry uploading {name}', { name: entry.name })} disabled={disabled} onClick={() => void draft.upload(entry.key, upload)}><Icon name="refresh" size={14}/></button>}
      <button type="button" className="icon-button" aria-label={t('Remove attachment {name}', { name: entry.name })} disabled={disabled} onClick={() => { draft.remove(entry.key); if (entry.attachment) discard(entry.attachment); }}><Icon name="close" size={14}/></button>
    </li>)}</ul>}
    {error && <p className="attachment-error" role="alert">{error}</p>}
  </>;
}
export function MessageAttachments({ files }: { files?: Attachment[] }) {
  if (!files?.length) return null;
  return <ul className="message-attachments" aria-label={t('Attachments')}>{files.map(file => <li key={file.id}><a className="attachment" href={attachmentUrl(file)} target="_blank" rel="noreferrer" title={t('Open attachment {name}', { name: file.name })}>
    <span className="attachment-icon"><FileIcon file={file}/></span><span className="attachment-info"><span className="attachment-name">{file.name}</span><small>{sizeLabel(file.size)}</small></span><Icon name="external" size={13}/>
  </a></li>)}</ul>;
}
