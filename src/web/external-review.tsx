import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AgentId, ExternalReview, ExternalReviewOptions, RuntimeStatus, Task } from '../shared.ts';
import { agentLabel, offeredAgents, shownModels } from './agent-choice.ts';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';
import './external-review.css';

type Api = <T>(route: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
type Channel = 'git' | 'space';
type ReviewProps = {
  api: Api; projectId: string; projectName: string; document?: string; runtimes: Partial<Record<AgentId, RuntimeStatus>>; preferredAgent: AgentId;
  tasks: Task[]; onClose?: () => void; onTask: (id: string) => void; onAgentSettings: () => void;
  conversation?: { id: string; result?: boolean };
};
export const externalReviewPath = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/external-review`;
const committedDocument = (files: string[], document?: string) => document && files.includes(document) ? document : files.find(file => file.endsWith('.tex'));

function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  return <a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">{children}<Icon name="external" size={14}/></a>;
}

function CopyText({ text = '', read, title, label }: { text?: string; read?: () => Promise<string>; title: string; label: string }) {
  const field = useRef<HTMLTextAreaElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), pending = useRef(false);
  const id = useId(), [feedback, setFeedback] = useState(''), [show, setShow] = useState(false), [current, setCurrent] = useState('');
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    clearTimeout(timer.current);
    const fresh = read ? read() : Promise.resolve(text);
    try {
      // Start clipboard access in the click event, including on Safari. The
      // promised blob only resolves once the server rechecks the receipt.
      if (read && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = fresh.then(value => new Blob([value], { type: 'text/plain' }));
        void blob.catch(() => undefined);
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      } else await navigator.clipboard.writeText(await fresh);
      if (read && show) setCurrent(await fresh);
      setFeedback(message => message === t('Copied') ? `${t('Copied')}\u00a0` : t('Copied'));
      timer.current = setTimeout(() => setFeedback(''), 2200);
    } catch {
      try {
        setCurrent(await fresh); setShow(true); setFeedback(t('Copy the text from the field below.'));
        if (show) requestAnimationFrame(() => { field.current?.focus(); field.current?.select(); });
      } catch (error) { setShow(false); setFeedback(error instanceof Error ? error.message : String(error)); }
    } finally { pending.current = false; }
  }
  useEffect(() => { if (show && feedback) { field.current?.focus(); field.current?.select(); } }, [show]);
  async function toggleText() {
    if (show) { setShow(false); return; }
    try { if (read) setCurrent(await read()); setShow(true); }
    catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
  }
  return <div className="external-copy">
    <div className="external-actions"><button type="button" className="button primary" onClick={() => void copy()}><Icon name="copy" size={15}/>{label}</button>
      <button type="button" className="button secondary" aria-expanded={show} aria-controls={id} onClick={() => void toggleText()}>{show ? t('Hide text') : t('Show text')}</button>
      <span role="status">{feedback}</span></div>
    <textarea ref={field} id={id} aria-label={title} hidden={!show} readOnly value={read ? current : text} spellCheck={false} rows={7}/>
  </div>;
}

function useReviewResource<T>(api: Api, route: string) {
  const [result, setResult] = useState<{ route: string; data?: T; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!route) return;
    const controller = new AbortController();
    void api<T>(route, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ route, data });
    }, error => { if (!controller.signal.aborted) setResult({ route, error: error.message }); });
    return () => controller.abort();
  }, [api, route, attempt]);
  return { ...(result?.route === route ? result : {}), retry: () => { setResult(undefined); setAttempt(attempt + 1); } };
}

function ReviewText({ api, route, label, title }: { api: Api; route: string; label: string; title: string }) {
  const result = useReviewResource<{ text: string }>(api, route);
  if (!route) return null;
  if (result.error) return <div className="external-actions"><p className="inline-error" role="alert">{result.error}</p><button type="button" className="button secondary" onClick={result.retry}>{t('Try again')}</button></div>;
  return result.data ? <CopyText key={route} text={result.data.text} title={title} label={label}/> : <p className="external-hint"><span className="spinner"/>{t('Preparing text…')}</p>;
}

export function useExternalReviewScope(api: Api, projectId: string | undefined, document?: string) {
  const result = useReviewResource<ExternalReviewOptions>(api, projectId ? `${externalReviewPath(projectId)}?scope=files` : '');
  const [selection, setSelection] = useState<{ key: string; files: string[] }>();
  const commit = result.data?.baseCommit;
  const key = `${projectId}:${commit}`;
  const suggested = result.data && committedDocument(result.data.files, document);
  const files = selection?.key === key ? selection.files : suggested ? [suggested] : [];
  return { ...result, commit, files, select: (files: string[]) => setSelection({ key, files }) };
}

function ReviewFiles({ available, files, onSelect }: { available: string[]; files: string[]; onSelect: (files: string[]) => void }) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const listed = available.filter(file => file.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  return <fieldset className="external-files"><legend>{t('Files to review')}</legend>
    <label className="sr-only" htmlFor={id}>{t('Filter files')}</label>
    <input id={id} name="filter" type="search" value={filter} placeholder={t('Filter files')} onChange={event => setFilter(event.target.value)}/>
    <div className="external-file-list">
      {listed.map(file => <label key={file}><input type="checkbox" name="files" checked={files.includes(file)} onChange={event => onSelect(event.target.checked ? [...files, file] : files.filter(path => path !== file))}/><span>{file}</span></label>)}
      {!listed.length && <p className="external-hint">{t('No matching committed files.')}</p>}
    </div>
  </fieldset>;
}

export function ExternalReviewScope({ scope }: { scope: ReturnType<typeof useExternalReviewScope> }) {
  if (scope.error) return <div className="external-actions"><p className="inline-error" role="alert">{scope.error}</p><button type="button" className="button secondary" onClick={scope.retry}>{t('Try again')}</button></div>;
  if (!scope.data) return <p className="muted" role="status">{t('Loading…')}</p>;
  return <details className="external-composer-scope">
    <summary>{t('Files to review')} <span>{scope.files.length === 1 ? scope.files[0] : t('{n} selected', { n: scope.files.length })}</span></summary>
    <div className="external-base"><span>{t('Base commit')}</span><code>{scope.commit?.slice(0, 12)}</code></div>
    <ReviewFiles available={scope.data.files} files={scope.files} onSelect={scope.select}/>
  </details>;
}

function activeStep(review: ExternalReview | undefined) {
  return review?.result ? 4 : review?.taskId ? 3 : review?.proposal ? 2 : review ? 1 : 0;
}

export function ExternalReviewDialog({ api, projectId, projectName, document, runtimes, preferredAgent, tasks, onClose, onTask, onAgentSettings, conversation }: ReviewProps) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), pending = useRef(false);
  const id = useId(), endpoint = externalReviewPath(projectId), fixedId = conversation?.id;
  const [options, setOptions] = useState<ExternalReviewOptions>();
  const [selected, setSelected] = useState(''), [step, setStep] = useState(0), [loadAttempt, setLoadAttempt] = useState(0);
  const [question, setQuestion] = useState(''), [files, setFiles] = useState<string[]>([]);
  const [channel, setChannel] = useState<Channel>('space'), [remoteName, setRemoteName] = useState(''), [page, setPage] = useState('');
  const [proposal, setProposal] = useState(''), [agentChoice, setAgentChoice] = useState(preferredAgent), [model, setModel] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const review = options?.reviews.find(item => item.request.requestId === selected);
  const reviewRoute = `${endpoint}/${selected}`;
  const task = review?.taskId ? tasks.find(item => item.id === review.taskId) : undefined;
  const remotes = options?.remotes ?? [], remote = remotes.find(item => item.name === remoteName);
  const agents = offeredAgents(runtimes).filter(agent => agent !== 'collaboration' && runtimes[agent]?.connected && runtimes[agent]?.authenticated);
  const agent = agents.includes(agentChoice) ? agentChoice : agents[0];
  const models = shownModels(agent ? runtimes[agent] : undefined);
  const chosenModel = models.some(item => item.id === model) ? model : '';
  const labels = [t('Prepare'), t('Send to reviewer'), t('Import proposal'), t('Implement locally'), t('Return result')];
  const maxStep = task || review?.result ? 4 : review?.proposal ? 3 : review ? 2 : 0;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step, Boolean(options)]);
  useEffect(() => {
    const controller = new AbortController();
    void api<ExternalReviewOptions>(fixedId ? `${endpoint}?review=${encodeURIComponent(fixedId)}` : endpoint, undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setOptions(value);
      chooseReview(value.reviews[0], value);
    }, failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [api, endpoint, fixedId, loadAttempt]);

  function chooseReview(next: ExternalReview | undefined, available = options) {
    const suggested = available && committedDocument(available.files, document);
    setSelected(next?.request.requestId ?? ''); setStep(activeStep(next)); setPage(next?.page ?? ''); setQuestion('');
    setFiles(suggested ? [suggested] : []); setProposal(''); setError('');
    setRemoteName(next?.git?.remote.name ?? available?.remotes.find(item => item.name === 'origin')?.name ?? available?.remotes[0]?.name ?? '');
    setChannel(next?.page ? 'space' : (next?.git || available?.remotes.length ? 'git' : 'space'));
  }
  function update(next: ExternalReview) {
    const key = next.request.requestId;
    setOptions(value => value && { ...value, reviews: value.reviews.some(item => item.request.requestId === key)
      ? value.reviews.map(item => item.request.requestId === key ? next : item) : [next, ...value.reviews] });
    setSelected(key);
  }
  async function act(label: string, work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError('');
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pending.current = false; setBusy(''); }
  }
  const change = (path: string, body: unknown) => api<ExternalReview>(`${reviewRoute}/${path}`, body).then(update);
  const move = (next: number) => { setError(''); setStep(next); };
  const errorId = `${id}-error`, pageHint = `${id}-page-hint`;
  const sending = conversation ? !conversation.result && !task && !review?.proposal : step === 1;
  const importing = conversation ? !conversation.result && !task : step === 2;
  const implementing = conversation ? !conversation.result : step === 3;
  const returning = conversation ? conversation.result : step === 4;

  const content = <section className={conversation ? 'external-review-dialog external-review-inline' : 'modal external-review-dialog'} aria-labelledby={conversation ? `${id}-step` : undefined}>
      {!conversation && <header className="external-review-header">
        <div><h2 id={`${id}-title`}>{t('External review')}</h2><p>{projectName}</p></div>
        <form method="dialog"><button className="icon-button" type="submit" aria-label={t('Close')} disabled={Boolean(busy)}><Icon name="close"/></button></form>
      </header>}
      {!conversation && options?.reviews.length ? <div className="external-review-history">
        <label htmlFor={`${id}-review`}>{t('Review request')}</label>
        <select id={`${id}-review`} value={selected} disabled={Boolean(busy)} onChange={event => chooseReview(options.reviews.find(item => item.request.requestId === event.target.value))}>
          <option value="">{t('New review request')}</option>
          {options.reviews.map(item => <option value={item.request.requestId} key={item.request.requestId}>{item.request.question} · {item.request.baseCommit.slice(0, 8)}</option>)}
        </select>
      </div> : null}
      {!conversation && <nav aria-label={t('Review progress')}><ol className="external-steps">
        {labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>
          <button type="button" disabled={Boolean(busy) || index > maxStep || (index === 0 && Boolean(review))} onClick={() => move(index)}>{label}</button>
        </li>)}
      </ol></nav>}
      <div className="external-step" aria-busy={Boolean(busy)}>
        <h3 ref={heading} id={`${id}-step`} tabIndex={-1}>{conversation ? returning ? labels[4] : t('ChatGPT Pro (web)') : labels[step]}</h3>
        {error && <p id={errorId} className="inline-error" role="alert">{error}</p>}
        {!options && (error ? <button type="button" className="button secondary" onClick={() => { setError(''); setLoadAttempt(loadAttempt + 1); }}>{t('Try again')}</button> : <p>{t('Loading…')}</p>)}
        {conversation && !returning && review && <><p className="external-question">{review.request.question}</p><div className="external-base"><span>{review.request.files.join(', ')}</span><code title={review.request.baseCommit}>{review.request.baseCommit.slice(0, 12)}</code></div></>}
        {!conversation && options && step === 0 && <form method="post" aria-labelledby={`${id}-step`} onSubmit={event => {
          event.preventDefault();
          if (!files.length) { setError(t('Select at least one file to review.')); return; }
          void act(t('Creating request…'), async () => { update(await api<ExternalReview>(endpoint, { baseCommit: options.baseCommit, files, question })); move(1); });
        }}>
          <p>{t('Choose a question and the committed files the reviewer should see.')}</p>
          <div className="external-base"><span>{t('Base commit')}</span><code title={options.baseCommit}>{options.baseCommit.slice(0, 12)}</code></div>
          <label htmlFor={`${id}-question`}>{t('What should the reviewer check?')}</label>
          <textarea id={`${id}-question`} name="question" required rows={3} value={question} onChange={event => setQuestion(event.target.value)} placeholder={t('For example, check whether the introduction overstates the results.')}/>
          <ReviewFiles available={options.files} files={files} onSelect={next => { setError(''); setFiles(next); }}/>
          <small>{t('{n} selected', { n: files.length })}</small>
          <div className="external-actions"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy || t('Create review request')}</button></div>
        </form>}
        {review && sending && <>
          <p>{t('Open a regular ChatGPT chat, choose Pro, and send the prompt. You can use the same request with another reviewer.')}</p>
          <fieldset className="external-choices"><legend>{t('Where should the reviewer write?')}</legend>
            <label><input type="radio" name={`${id}-channel`} value="git" checked={channel === 'git'} disabled={!remotes.length && !review.git} onChange={() => setChannel('git')}/><span>{t('Git branch')}</span></label>
            <label><input type="radio" name={`${id}-channel`} value="space" checked={channel === 'space'} onChange={() => setChannel('space')}/><span>{t('ChatGPT Space Page')}</span></label>
          </fieldset>
          {channel === 'git' ? <div className="external-channel">
            {review.git ? <>
              <p>{t('Ask the reviewer to write to this branch. If it returns JSON in chat, paste it in the next step.')}</p>
              <p className="external-branch"><code>{review.git.branch}</code></p>
              <ReviewText api={api} route={`${reviewRoute}/prompt?via=git`} label={t('Copy Git prompt')} title={t('Git prompt')}/>
            </> : <form method="post" aria-label={t('Publish review branch')} onSubmit={event => { event.preventDefault(); void act(t('Publishing branch…'), () => change('github', { remote: remoteName, revision: remote?.revision })); }}>
              <label htmlFor={`${id}-remote`}>{t('Git remote')}</label>
              <select id={`${id}-remote`} name="remote" value={remoteName} onChange={event => setRemoteName(event.target.value)} required>
                {!remoteName && <option value="">{t('Choose a Git remote')}</option>}
                {remotes.map(item => <option value={item.name} key={item.name}>{item.repository ? `${item.name} · ${item.repository}` : item.name}</option>)}
              </select>
              <p className="external-hint">{t('Publishing sends the complete Git commit and its history to the selected remote. The request names the files to check.')}</p>
              {remote?.url && <a href={remote.url} target="_blank" rel="noopener noreferrer">{remote.repository}</a>}
              <div className="external-actions"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy || t('Publish review branch')}</button></div>
            </form>}
          </div> : <div className="external-channel">
            <form method="post" aria-label={t('Save Page link')} onSubmit={event => { event.preventDefault(); void act(t('Saving…'), () => change('page', { url: page.trim() })); }}>
              <label htmlFor={`${id}-page`}>{t('Space Page link (optional)')}</label>
              <p className="external-hint" id={pageHint}>{t('Leave blank to ask ChatGPT to create a private Page. The prompt includes the selected text.')}</p>
              <div className="external-actions"><input id={`${id}-page`} name="page" value={page} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} aria-describedby={pageHint} placeholder="https://chatgpt.com/space/…" onChange={event => setPage(event.target.value)}/>
                <button type="submit" className="button secondary" disabled={Boolean(busy) || page.trim() === (review.page ?? '')}>{t('Save Page link')}</button></div>
            </form>
            <ReviewText key={review.page} api={api} route={`${reviewRoute}/prompt?via=space`} label={t('Copy Space prompt')} title={t('Space prompt')}/>
            {review.page && <ExternalLink url={review.page}>{t('Open Space Page')}</ExternalLink>}
          </div>}
          {channel === 'space' || review.git ? <div className="external-actions"><ExternalLink url="https://chatgpt.com/">{t('Open ChatGPT')}</ExternalLink>{!conversation && <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => move(2)}>{t('Go to proposal')}</button>}</div> : null}
          {!remotes.length && !review.git && <p className="external-hint">{t('Add a Git remote to publish a review branch. Space works with the committed text.')}</p>}
        </>}
        {review && importing && <>
          <p>{t('Fetch the proposal from Git or paste the JSON block from Space or chat. Papilot checks the commit and quoted text.')}</p>
          {!task && <>
            {review.git && <div className="external-actions"><button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => void act(t('Fetching proposal…'), () => change('proposal', { via: 'git' }))}>{busy || t('Fetch Git proposal')}</button></div>}
            <form method="post" aria-label={t('Import proposal')} onSubmit={event => { event.preventDefault(); void act(t('Checking proposal…'), () => change('proposal', { text: proposal })); }}>
              <label htmlFor={`${id}-proposal`}>{t('Proposal JSON or Page Markdown')}</label>
              <textarea id={`${id}-proposal`} name="proposal" rows={5} required spellCheck={false} value={proposal} onChange={event => { setError(''); setProposal(event.target.value); }}/>
              <div className="external-actions"><button type="submit" className="button secondary" disabled={Boolean(busy)}>{t('Check pasted proposal')}</button></div>
            </form>
          </>}
          {review.proposal && <div className="external-proposal">
            <strong>{t('Proposal checked')}</strong>
            <ol>{review.proposal.changes.map((change, index) => <li key={index}><code>{change.file}</code><blockquote>{change.original}</blockquote><p>{change.suggestion}</p><small>{change.reason}</small></li>)}</ol>
            {!conversation && <div className="external-actions"><button type="button" className="button primary" disabled={Boolean(busy)} onClick={() => move(3)}>{t('Continue to local agent')}</button></div>}
          </div>}
        </>}
        {review?.proposal && implementing && <>
          <p>{t('The local agent works from the request’s commit. Review its PDF changes in the resulting task.')}</p>
          {task ? <>
            <div className="external-base"><strong>{task.title}</strong><code>{review.request.baseCommit.slice(0, 12)}</code></div>
            {task.error && <p className="inline-error">{task.error}</p>}
            <div className="external-actions"><button type="button" className="button primary" onClick={() => onTask(task.id)}>{t('Open local task')}</button>
              {!conversation && <button type="button" className="button secondary" onClick={() => move(4)}>{t('Continue to result')}</button>}</div>
          </> : agents.length ? <form method="post" aria-labelledby={`${id}-step`} onSubmit={event => {
            event.preventDefault();
            void act(t('Starting local agent…'), async () => {
              const started = await api<{ review: ExternalReview; task: Task }>(`${reviewRoute}/task`, { agent, model: chosenModel, digest: review.proposal?.digest });
              update(started.review); onTask(started.task.id);
            });
          }}>
            <label htmlFor={`${id}-agent`}>{t('Local agent')}</label>
            <select id={`${id}-agent`} name="agent" value={agent} onChange={event => { setAgentChoice(event.target.value as AgentId); setModel(''); }}>
              {agents.map(value => <option value={value} key={value}>{agentLabel(value)}</option>)}
            </select>
            {models.length > 0 && <><label htmlFor={`${id}-model`}>{t('Model')}</label><select id={`${id}-model`} name="model" value={chosenModel} onChange={event => setModel(event.target.value)}>
              <option value="">{t('Default model')}</option>{models.map(item => <option value={item.id} key={item.id}>{item.name || item.id}</option>)}
            </select></>}
            <div className="external-actions"><button type="submit" className="button primary" disabled={Boolean(busy)}>{busy || t('Start local agent')}</button></div>
          </form> : <><p className="external-hint">{t('Connect a local agent to implement the proposal.')}</p><button type="button" className="button secondary" onClick={onAgentSettings}>{t('Open agent settings')}</button></>}
        </>}
        {review && returning && <>
          <p>{t('Accept or reject the proposed edits in the local task. Then share a receipt of the accepted changes with the reviewer.')}</p>
          <div className="external-actions">
            {!conversation && task && <button type="button" className="button secondary" onClick={() => onTask(task.id)}>{t('Open local task')}</button>}
            <button type="button" className="button secondary" disabled={Boolean(busy) || !task} onClick={() => void act(t('Preparing receipt…'), () => change('receipt', {}))}>{busy || t('Prepare receipt')}</button>
          </div>
          {review.result && <div className="external-channel">
            <p><strong>{review.result.receipt.status === 'no_changes' ? t('No changes accepted') : t('Receipt ready')}</strong> <code>{review.result.receipt.resultCommit.slice(0, 12)}</code></p>
            <p>{t('Paste the receipt on the Space Page or send it to the reviewer in chat.')}</p>
            <CopyText key={`${review.result.receipt.resultCommit}:${task?.updatedAt}`} read={() => api<{ text: string }>(`${reviewRoute}/receipt?resultCommit=${review.result!.receipt.resultCommit}`).then(result => result.text)} label={t('Copy result for Space')} title={t('Review result')}/>
            <div className="external-actions">
              <ExternalLink url={review.page ?? 'https://chatgpt.com/'}>{review.page ? t('Open Space Page') : t('Open ChatGPT')}</ExternalLink>
              {review.git && (!review.result.published ? <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => void act(t('Publishing result…'), () => change('result', { resultCommit: review.result?.receipt.resultCommit }))}>{t('Publish result branch')}</button>
                : review.result.published.url ? <ExternalLink url={review.result.published.url}>{t('Open Git receipt')}</ExternalLink>
                : <code>{review.result.published.branch}</code>)}
            </div>
          </div>}
        </>}
      </div>
      {!conversation && <footer className="external-review-footer">
        {step > 1 && <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => move(step - 1)}><Icon name="chevronLeft" size={14}/>{t('Back')}</button>}
        {review && <button type="button" className="button secondary" disabled={Boolean(busy)} onClick={() => chooseReview(undefined)}>{t('New review request')}</button>}
      </footer>}
    </section>;
  return conversation ? content : <dialog ref={dialog} className="modal-backdrop external-review-backdrop" aria-labelledby={`${id}-title`} onClose={event => { if (!event.currentTarget.open) onClose?.(); }}
    onCancel={event => { if (pending.current) event.preventDefault(); }}>
    {content}
  </dialog>;
}

export function ExternalReviewResult({ requestId, ...props }: Omit<ReviewProps, 'conversation'> & { requestId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="external-result-disclosure" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('Return result')}</summary>
    {open && <ExternalReviewDialog {...props} conversation={{ id: requestId, result: true }}/>}
  </details>;
}
