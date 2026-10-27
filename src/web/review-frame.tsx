import { useEffect, useRef, useState } from 'react';
import type { Task } from '../shared.ts';

// The embedded viewer shares our origin. Keep its decision controls, but remove
// navigation and the task title that the workspace already provides.
function compactReviewFrame(doc: Document, scale: number) {
  if (!doc || doc.getElementById('papilot-embed-style')) return;
  doc.documentElement.style.setProperty('--pdf-reading-scale', String(scale));
  const style = doc.createElement('style'); style.id = 'papilot-embed-style';
  style.textContent = `
    .bar{display:flex;min-height:36px;padding:3px 12px;gap:12px;flex-wrap:nowrap}
    .bar .overview-link,.bar .identity h1{display:none}
    .bar .identity{flex:1;flex-direction:row;gap:6px}
    .bar .identity span,.bar .meter,.bar .ghost{font-size:11px}
    .bar .meter{display:flex;order:initial;width:auto}
    .bar .bar-end{margin-left:0;gap:6px}
    .bar .ghost{padding:3px 8px}
    .bar .ghost.round{width:25px;height:25px;padding:0}
    #paper{--paper-top:10px;padding-top:10px}
    .part-title{font-size:16px;margin:5px 0 10px}
      .side,.context{overflow-x:auto;overscroll-behavior-x:contain}
      .side .pdf-strip,.context .pdf-strip{width:calc(100% * var(--pdf-reading-scale,1));max-width:none}
    @media(max-width:680px){
      .bar{min-height:44px}.bar .ghost{min-height:36px;font-size:12px}.bar .ghost.round{width:36px;height:36px}
      .bar .identity span,.bar .meter{font-size:12px}
      .change-map{display:none}.review-body>#paper{padding-right:6px;padding-bottom:40px}
      .change-head{padding:8px}.change-head .change-where{min-width:0;overflow-wrap:anywhere}
      .change-head .actions{gap:0;box-shadow:none}.change-head .actions button{min-height:44px;padding:6px;font-size:12px}
      .change-head .actions .nav{min-width:32px;padding:4px}.change-head .position{min-width:26px;font-size:10px}
      .change-head .link{min-height:36px;padding:6px}.change-head .dock{margin:0}
      .composer{left:8px!important;right:8px!important;width:auto!important;max-width:none;bottom:8px;transform:none;max-height:calc(100% - 16px);overflow:auto}
      .composer textarea{font-size:16px;max-height:min(140px,30vh)}.composer button{min-height:44px}
    }
    @media(max-width:420px){.bar{gap:7px;padding-inline:8px}.bar .meter{font-size:10px}}
  `;
  doc.head.append(style);
}


// The iframe can finish loading an HTTP error or an empty document. Wait for the
// actual viewer, keep watching slow startup, and let the user retry safely.
export function ReviewFrame({ task, scale }: { task: Task; scale: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const observer = useRef<MutationObserver | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'slow' | 'error'>('loading');
  useEffect(() => {
    const timer = setTimeout(() => setPhase(value => value === 'loading' ? 'slow' : value), 15000);
    return () => { clearTimeout(timer); observer.current?.disconnect(); };
  }, [attempt]);
  useEffect(() => {
    try { frame.current?.contentDocument?.documentElement.style.setProperty('--pdf-reading-scale', String(scale)); } catch { /* A browser error document may be inaccessible. */ }
  }, [scale]);
  function loaded() {
    observer.current?.disconnect();
    try {
      const doc = frame.current?.contentDocument;
      if (!doc || (!doc.getElementById('root') && !doc.getElementById('paper'))) { setPhase('error'); return; }
      compactReviewFrame(doc, scale);
      const inspect = () => {
        const paper = doc.getElementById('paper');
        if (!paper) return;
        if (paper.querySelector('[role="alert"]')) { setPhase('error'); return; }
        if (!paper.querySelector('.waiting')) { setPhase('ready'); observer.current?.disconnect(); }
      };
      observer.current = new MutationObserver(inspect);
      observer.current.observe(doc.body, { childList: true, subtree: true });
      inspect();
    } catch { setPhase('error'); }
  }
  const ready = phase === 'ready';
  return <div className={'review-viewport' + (ready ? '' : ' review-pending')} aria-busy={!ready}>
    <iframe ref={frame} key={attempt} title={`${task.title} PDF change review`} src={`/review/${task.projectId}/?task=${task.name}`} onLoad={loaded} onError={() => setPhase('error')} className="review-frame" aria-hidden={!ready} tabIndex={ready ? 0 : -1}/>
    {!ready && <div className="review-loading"><p role={phase === 'error' ? 'alert' : 'status'}>{phase === 'error' ? 'The PDF review could not be loaded.' : phase === 'slow' ? 'The PDF review is taking longer than expected.' : 'Loading PDF review…'}</p>{phase !== 'loading' && <button className="button secondary" onClick={() => { setPhase('loading'); setAttempt(value => value + 1); }}>Reload review</button>}</div>}
  </div>;
}
