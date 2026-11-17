import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { CreatePaperPanel } from './create-paper-dialog.tsx';
import { ImportPanel } from './import-dialog.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './new-paper-dialog.css';

type Tab = 'blank' | 'import' | 'templates';
type Props = Omit<ComponentProps<typeof ImportPanel>, 'onBusyChange'> & {
  initialTab?: Tab;
  preset?: { id: string; version: string };
};
export function NewPaperDialog({ initialTab = 'blank', preset, onClose, ...props }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  const [tab, setTab] = useState<Tab>(preset ? 'templates' : initialTab);
  const [importVisited, setImportVisited] = useState(initialTab === 'import');
  const [createVisited, setCreateVisited] = useState(Boolean(preset) || initialTab !== 'import');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>('[role="tabpanel"]:not([hidden]) input:not([hidden])')?.focus();
    return () => element.close();
  }, []);
  function select(next: Tab) {
    if (busy) return;
    if (next === 'import') setImportVisited(true);
    else setCreateVisited(true);
    setTab(next);
  }
  function close() {
    if (busy) return;
    // Close while the element is still connected so the browser can return
    // focus before React unmounts the dialog.
    dialog.current?.close();
    onClose();
  }
  const tabs = [
    { value: 'blank', label: t('Blank'), icon: 'plus' },
    { value: 'import', label: t('Import or open'), icon: 'download' },
    { value: 'templates', label: t('Templates'), icon: 'paper' },
  ] as const;
  return <dialog ref={dialog} className="modal-backdrop new-paper-backdrop" aria-labelledby={id + '-title'} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="modal new-paper-dialog">
      <button type="button" className="modal-close icon-button" aria-label={t('Close')} disabled={busy} onClick={close}><Icon name="close"/></button>
      <h2 id={id + '-title'}>{t('New paper')}</h2>
      <div className="new-paper-tabs" role="tablist" aria-label={t('Paper source')} onKeyDown={event => {
        if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = buttons.indexOf(event.target as HTMLButtonElement);
        if (current < 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus(); select(tabs[next].value);
      }}>
        {tabs.map(item => <button key={item.value} type="button" role="tab" id={id + '-' + item.value} aria-selected={tab === item.value} tabIndex={tab === item.value ? 0 : -1} disabled={busy} onClick={() => select(item.value)}><Icon name={item.icon} size={15}/>{item.label}</button>)}
      </div>
      <div role="tabpanel" aria-labelledby={id + '-' + (tab === 'templates' ? 'templates' : 'blank')} hidden={tab === 'import'}>
        {createVisited && <CreatePaperPanel api={props.api} onDone={props.onDone} preset={preset} tab={tab === 'templates' ? 'templates' : 'blank'} active={tab !== 'import'} onBusyChange={setBusy}/>}
      </div>
      <div role="tabpanel" aria-labelledby={id + '-import'} hidden={tab !== 'import'}>
        {importVisited && <ImportPanel {...props} onClose={close} onBusyChange={setBusy}/>}
      </div>
    </section>
  </dialog>;
}
