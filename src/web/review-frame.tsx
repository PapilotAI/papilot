import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Task } from '../shared.ts';

// The embedded viewer shares our origin. Keep its decision controls, but remove
// navigation and the task title that the workspace already provides. Its bar
// becomes the review toolbar; Papilot's PDF tools sit in the reserved space.
function compactReviewFrame(doc: Document, scale: number, reserve: number) {
  if (!doc || doc.getElementById('papilot-embed-style')) return;
  doc.documentElement.style.setProperty('--pdf-reading-scale', String(scale));
  doc.documentElement.toggleAttribute('data-papilot-fit', scale === 1);
  doc.documentElement.style.setProperty('--papilot-tools', `${reserve}px`);
  const style = doc.createElement('style'); style.id = 'papilot-embed-style';
  style.textContent = `
    :root{--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Noto Sans SC",system-ui,sans-serif;--accent:#356aa0;--comment:#356aa0;--frame:#f3f3f1;--line:#e8e7e3;--muted:#8c8b85;--ink:#1b1b19;--head:#fafaf9;font-size:14px}
    .banner{border-radius:10px}
    .bar{display:flex;align-items:center;height:44px;min-height:44px;padding:0 calc(var(--papilot-tools,0px) + 12px) 0 14px;gap:12px;flex-wrap:nowrap;overflow:hidden}
    .bar .overview-link,.bar .identity h1{display:none}
    .bar .identity{flex:1;min-width:0;flex-direction:row;gap:6px}
    .bar .identity span{font-size:13px;font-weight:600;color:#55544f;overflow:hidden;text-overflow:ellipsis}
    .bar .meter{display:flex;order:initial;width:auto;font-size:13px}
    .bar .bar-end{margin-left:0;gap:6px}
    .bar .ghost{font-size:13px;font-weight:500;height:28px;padding:0 10px;border-radius:7px}
    .bar .ghost:hover{text-decoration:none;background:#efefec}
    .bar .accept-all,.bar .reject-all{border-color:#d6d5d0;background:#fff;box-shadow:0 1px 2px rgb(28 27 25/.06)}
    .bar .accept-all{color:var(--accept)}.bar .reject-all{color:var(--reject)}
    .bar .ghost.round{width:28px;height:28px;padding:0;border-radius:50%}
    .bar .status{font-size:13px}
    .sheet{border-radius:4px;box-shadow:0 1px 2px rgb(28 27 25/.06),0 8px 24px rgb(28 27 25/.08)}
    .change-head{font-size:13px}.link{font-size:13px}
    /* The current change's decision buttons; on phones the bar is a solid toolbar at the bottom. */
    .change-head .actions{gap:3px;padding:4px;background:#fff;border:1px solid #d6d5d0;border-radius:12px;box-shadow:0 1px 2px rgb(28 27 25/.06),0 4px 12px rgb(28 27 25/.06)}
    .change-head .actions button{height:30px;padding:0 13px;border:1px solid transparent;border-radius:8px;font-size:13.5px;font-weight:500;line-height:1}
    .change-head .actions .nav{width:30px;padding:0;font-size:19px;font-weight:400;color:#55544f}
    .change-head .actions .nav:hover:not(:disabled){background:#efefec}
    .change-head .actions .nav:disabled{color:#cfcfcf;opacity:1}
    .change-head .position{min-width:38px;font-size:12.5px;color:#55544f;font-variant-numeric:tabular-nums}
    .change-head .actions .accept{background:var(--accept);border-color:var(--accept);color:#fff}
    .change-head .actions .accept:hover:not(:disabled){background:#155c38;border-color:#155c38}
    .change-head .actions .reject{border-color:#e2bcc0;color:var(--reject)}
    .change-head .actions .reject:hover:not(:disabled){background:#fbf2f3;border-color:var(--reject)}
    .change-head .actions .comment{border-color:#c6d5e5;color:var(--comment)}
    .change-head .actions .comment:hover:not(:disabled){background:#f0f4f8;border-color:var(--comment)}
    .change-head .actions .skip{border-color:#d6d5d0;color:#1b1b19}
    .change-head .actions .skip:hover{background:#efefec}
    .change-head .complete{padding:0 10px;font-size:13.5px;color:var(--accept)}
    .change-head .actions .undo{margin-left:3px;padding:0 10px;font-weight:400;color:#55544f}
    .change-head .actions .undo:hover:not(:disabled){background:#efefec}
    .change-head .actions .undo:disabled{color:#bdbdbd;opacity:1}
    .change-head .actions .accept:disabled,.change-head .actions .reject:disabled,.change-head .actions .comment:disabled{opacity:.4}
    /* Wider than a phone, the decision bar is a flat strip along the bottom of the
       current change's header: moving between changes on the left, deciding on
       the right. It belongs to the header rather than floating over it. */
    @media(min-width:681px){
      .change-head .dock{order:9;flex-basis:calc(100% + 24px);justify-content:flex-start;margin:6px -12px -8px;padding:5px 8px 5px 6px;border-top:1px solid var(--line)}
      .change-head .actions{flex:1;flex-wrap:nowrap;justify-content:flex-start;gap:4px;max-width:none;padding:0;background:none;border:0;border-radius:0;box-shadow:none}
      .change-head .actions>*{order:4}
      .change-head .actions>.nav:first-child{order:1}.change-head .actions>.position{order:2}.change-head .actions>.nav:not(:first-child){order:3}
      .change-head .actions .undo{order:5}
      .change-head .actions .accept,.change-head .actions .skip,.change-head .actions .complete{margin-left:auto}
      .change-head .position{min-width:34px}
    }
    #paper{--paper-top:14px;padding-top:14px}
    .review-body>#paper{padding-right:34px}
    .change-map{top:10px;bottom:10px;right:8px;width:14px;border:0;border-radius:0;background:none;box-shadow:none}
    .change-map::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;border-radius:2px;background:var(--line)}
    .change-map-viewport{left:50%;right:auto;width:4px;margin-left:-2px;border:0;border-radius:999px;background:rgb(24 24 27/.1);transition:width .15s,margin .15s,background-color .15s}
    .change-map:hover .change-map-viewport,.change-map-viewport:active{width:6px;margin-left:-3px;background:rgb(24 24 27/.2)}
    .change-map-mark{left:50%;width:4px;min-height:3px;margin-left:-2px;border-radius:999px;transition:width .15s,margin .15s}
    .change-map-mark[aria-current]{outline:0;width:6px;margin-left:-3px;box-shadow:0 0 0 2px var(--frame)}
    .change-map:hover .change-map-mark{width:6px;margin-left:-3px}
    .change-map .change-map-mark:hover{outline:0;width:8px;margin-left:-4px;box-shadow:0 0 0 2px var(--frame)}
    .change-map-mark:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
    ::-webkit-scrollbar-thumb{background-color:rgb(24 24 27/.14);border:3px solid transparent;border-radius:999px;background-clip:padding-box}
    ::-webkit-scrollbar-thumb:hover{background-color:rgb(24 24 27/.32);border-width:2px}
    @supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:rgb(24 24 27/.2) transparent}}
    .part-title{font-size:15px;margin:6px 0 10px}
    .side,.context{overflow-x:auto;overscroll-behavior-x:contain}
    .side .pdf-strip,.context .pdf-strip{width:calc(100% * var(--pdf-reading-scale,1));max-width:none}
    @media(max-width:680px){
      .bar{height:48px;min-height:48px;padding-left:12px;gap:8px}.bar .ghost{min-height:36px;font-size:12px}
      .bar .ghost.round{display:none}.bar .identity span,.bar .meter{font-size:12px}
      .change-map{display:none}.review-body>#paper{padding-left:8px;padding-right:8px;padding-bottom:84px}
      .side.before::after,.side.after::after{content:none}
      .change-head{align-items:center;padding:4px 6px 4px 10px;gap:6px}.change-head .change-where{min-width:0}
      .change-head .link{min-height:36px;padding:0 6px}
      .change-head .dock{position:fixed;z-index:6;left:8px;right:8px;bottom:8px;margin:0}
      .change-head .actions{width:100%;flex-wrap:nowrap;justify-content:space-between;gap:4px;padding:5px;border-radius:16px;border-color:#d6d5d0;box-shadow:0 2px 4px rgb(28 27 25/.05),0 10px 28px rgb(28 27 25/.16)}
      .change-head .actions button{flex:1 1 auto;min-width:0;height:44px;padding:0 6px;border-radius:11px;font-size:15px}
      .change-head .actions .nav{flex:0 0 auto;width:32px;min-width:32px;padding:0}.change-head .position{min-width:30px;font-size:11.5px}
      .change-head .actions .undo{flex:0 0 auto;margin-left:0;padding:0 8px;font-size:14px}
      .composer{left:8px!important;right:8px!important;width:auto!important;max-width:none;bottom:70px;transform:none;max-height:calc(100% - 86px);overflow:auto}
      .composer textarea{font-size:16px;max-height:min(140px,30vh)}.composer button{min-height:44px}
      .side .pdf-strip,.context .pdf-strip{width:calc(100% * var(--pdf-reading-scale,1) * var(--pdf-crop-scale,1));margin-left:calc(-100% * var(--pdf-reading-scale,1) * var(--pdf-crop-scale,1) * var(--pdf-crop-shift,0))}
      [data-papilot-fit] .side,[data-papilot-fit] .context{overflow-x:hidden}
    }
    @media(max-width:480px){.bar .identity,.bar .meter{display:none}.bar .bar-end{gap:4px}}
    @media(max-width:400px){.change-head .position{display:none}}
    @media(max-width:350px){.change-head .actions .nav{display:none}}
    @media(max-width:360px){.bar .ghost{padding:0 7px;font-size:11.5px}}
  `;
  doc.head.append(style);
}

// Phones read the text block rather than the page. Measure the text layer's
// shared left and right edges across all strips and crop the page margins
// (used only by the narrow-screen strip rule above).
function cropMargins(doc: Document) {
  let min = 1, max = 0;
  for (const strip of doc.querySelectorAll<HTMLElement>('.pdf-strip')) {
    const box = strip.getBoundingClientRect(); if (!box.width) continue;
    for (const line of strip.querySelectorAll('.pdf-text-line')) {
      const first = line.firstElementChild?.getBoundingClientRect(), last = line.lastElementChild?.getBoundingClientRect();
      if (!first?.width || !last?.width) continue;
      min = Math.min(min, (first.left - box.left) / box.width); max = Math.max(max, (last.right - box.left) / box.width);
    }
  }
  const root = doc.documentElement.style, span = max - min + 0.04;
  if (max <= min || span >= 0.95) { root.removeProperty('--pdf-crop-scale'); root.removeProperty('--pdf-crop-shift'); return; }
  root.setProperty('--pdf-crop-scale', (1 / span).toFixed(4)); root.setProperty('--pdf-crop-shift', Math.max(0, min - 0.02).toFixed(4));
}


// The iframe can finish loading an HTTP error or an empty document. Wait for the
// actual viewer, keep watching slow startup, and let the user retry safely.
export function ReviewFrame({ task, scale, tools }: { task: Task; scale: number; tools?: ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(0);
  const observer = useRef<MutationObserver | null>(null);
  const cropper = useRef<MutationObserver | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'slow' | 'error'>('loading');
  useEffect(() => {
    const timer = setTimeout(() => setPhase(value => value === 'loading' ? 'slow' : value), 15000);
    return () => { clearTimeout(timer); observer.current?.disconnect(); cropper.current?.disconnect(); };
  }, [attempt]);
  useEffect(() => {
    const element = toolbar.current; if (!element) return;
    const observer = new ResizeObserver(() => setReserve(Math.ceil(element.offsetWidth)));
    observer.observe(element); return () => observer.disconnect();
  }, [Boolean(tools)]);
  useEffect(() => {
    try {
      const root = frame.current?.contentDocument?.documentElement;
      root?.style.setProperty('--pdf-reading-scale', String(scale)); root?.style.setProperty('--papilot-tools', `${reserve}px`);
      root?.toggleAttribute('data-papilot-fit', scale === 1);
    } catch { /* A browser error document may be inaccessible. */ }
  }, [scale, reserve]);
  function loaded() {
    observer.current?.disconnect();
    try {
      const doc = frame.current?.contentDocument;
      if (!doc || (!doc.getElementById('root') && !doc.getElementById('paper'))) { setPhase('error'); return; }
      compactReviewFrame(doc, scale, reserve);
      // Strips render after the viewer starts; re-measure the text edges when they change.
      let pending: ReturnType<typeof setTimeout> | undefined;
      cropper.current?.disconnect();
      cropper.current = new MutationObserver(() => { clearTimeout(pending); pending = setTimeout(() => cropMargins(doc), 150); });
      cropper.current.observe(doc.body, { childList: true, subtree: true });
      const inspect = () => {
        const paper = doc.getElementById('paper');
        if (!paper) return;
        if (paper.querySelector('[role="alert"]')) { setPhase('error'); return; }
        if (!paper.querySelector('.waiting')) { setPhase('ready'); observer.current?.disconnect(); cropMargins(doc); }
      };
      observer.current = new MutationObserver(inspect);
      observer.current.observe(doc.body, { childList: true, subtree: true });
      inspect();
    } catch { setPhase('error'); }
  }
  const ready = phase === 'ready';
  return <div className={'review-viewport' + (ready ? '' : ' review-pending')} aria-busy={!ready}>
    <iframe ref={frame} key={attempt} title={`${task.title} PDF change review`} src={`/review/${task.projectId}/?task=${task.name}`} onLoad={loaded} onError={() => setPhase('error')} className="review-frame" aria-hidden={!ready} tabIndex={ready ? 0 : -1}/>
    {tools && <div ref={toolbar} className="review-tools">{tools}</div>}
    {!ready && <div className="review-loading"><p role={phase === 'error' ? 'alert' : 'status'}>{phase === 'error' ? 'The PDF review could not be loaded.' : phase === 'slow' ? 'The PDF review is taking longer than expected.' : 'Loading PDF review…'}</p>{phase !== 'loading' && <button className="button secondary" onClick={() => { setPhase('loading'); setAttempt(value => value + 1); }}>Reload review</button>}</div>}
  </div>;
}
