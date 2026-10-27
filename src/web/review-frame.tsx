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
    :root{--sans:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","PingFang SC","Noto Sans SC",system-ui,sans-serif;--accent:#2563eb;--comment:#2563eb;--accept:#15803d;--reject:#dc2626;--frame:#f3f3f3;--line:#e8e8e8;--muted:#8a8a8a;--ink:#171717;--head:#fafafa;font-size:14px}
    .banner{border-radius:10px}
    .bar{display:flex;align-items:center;height:44px;min-height:44px;padding:0 calc(var(--papilot-tools,0px) + 12px) 0 14px;gap:12px;flex-wrap:nowrap;overflow:hidden}
    .bar .overview-link,.bar .identity h1{display:none}
    .bar .identity{flex:1;min-width:0;flex-direction:row;gap:6px}
    .bar .identity span{font-size:13px;font-weight:600;color:#525252;overflow:hidden;text-overflow:ellipsis}
    .bar .meter{display:flex;order:initial;width:auto;font-size:13px}
    .bar .bar-end{margin-left:0;gap:6px}
    .bar .ghost{font-size:13px;font-weight:500;height:28px;padding:0 10px;border-radius:7px}
    .bar .ghost:hover{text-decoration:none;background:#efefef}
    .bar .accept-all,.bar .reject-all{display:inline-flex;align-items:center;gap:6px;border-color:#d6d6d6;background:#fff;color:var(--ink);box-shadow:0 1px 2px rgb(0 0 0/.06)}
    .bar .accept-all:hover,.bar .reject-all:hover{background:#fafafa;border-color:#c4c4c4}
    .bar .ghost.round{width:28px;height:28px;padding:0;border-radius:50%}
    .bar .status{font-size:13px}
    .sheet{border-radius:4px;box-shadow:0 1px 2px rgb(0 0 0/.06),0 8px 24px rgb(0 0 0/.08)}
    .change-head{font-size:13px;background:#fafafa}.link{font-size:13px}
    /* The current change: a thin accent outline and a warm header, like a selected
       row in the workspace, rather than a blue frame on a blue-grey header. */
    .change.current{box-shadow:0 0 0 1px #93b4f5,0 0 0 4px rgb(37 99 235/.07)}
    .change.current .change-head{background:#f5f5f5;color:var(--ink)}
    .change-head .link{display:inline-flex;align-items:center;height:28px;padding:0 8px;border-radius:7px;color:#525252;font-weight:500}
    .change-head .link:hover{background:#ebebeb;color:var(--ink);text-decoration:none}
    .change-head .link.active{background:#eff6ff;color:var(--accent);text-decoration:none}
    /* Decision buttons are plain text actions like the rest of the header
       (Copy reference, LaTeX, Undo): a coloured icon says what each does, and
       hovering tints it green, red or blue. On phones the bar is a solid
       toolbar at the bottom. */
    :root{--icon-copy:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'><rect x='8' y='8' width='12' height='12' rx='2'/><path d='M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'/></svg>");--icon-check:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6 9 17l-5-5'/></svg>");--icon-cross:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round'><path d='M18 6 6 18M6 6l12 12'/></svg>");--icon-comment:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round'><path d='M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z'/></svg>")}
    .change-head .actions .accept::before,.change-head .actions .reject::before,.change-head .actions .comment::before,.bar .accept-all::before,.bar .reject-all::before{content:"";flex:none;width:13px;height:13px;background:currentColor;-webkit-mask:var(--icon) center/contain no-repeat;mask:var(--icon) center/contain no-repeat}
    .change-head .actions .accept,.bar .accept-all{--icon:var(--icon-check)}.change-head .actions .reject,.bar .reject-all{--icon:var(--icon-cross)}.change-head .actions .comment{--icon:var(--icon-comment)}
    .change-head .actions .accept::before,.bar .accept-all::before{background:var(--accept)}.change-head .actions .reject::before,.bar .reject-all::before{background:var(--reject)}.change-head .actions .comment::before{background:var(--accent)}
    .change-head .actions{gap:3px;padding:4px;background:#fff;border:1px solid #d6d6d6;border-radius:12px;box-shadow:0 1px 2px rgb(0 0 0/.06),0 4px 12px rgb(0 0 0/.06)}
    .change-head .actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 11px;border:1px solid transparent;border-radius:7px;font-size:13px;font-weight:500;line-height:1;transition:background-color .15s,border-color .15s}
    .change-head .actions .nav{width:28px;padding:0;font-size:19px;font-weight:400;color:#525252}
    .change-head .actions .nav:hover:not(:disabled){background:#ebebeb}
    .change-head .actions .nav:disabled{color:#cfcfcf;opacity:1}
    .change-head .position{min-width:38px;font-size:12.5px;color:#525252;font-variant-numeric:tabular-nums}
    .change-head .actions .accept,.change-head .actions .reject,.change-head .actions .comment,.change-head .actions .skip{background:transparent;color:var(--ink)}
    .change-head .actions .accept:hover:not(:disabled){background:#e8f6ee;color:var(--accept)}
    .change-head .actions .reject:hover:not(:disabled){background:#fdeeee;color:var(--reject)}
    .change-head .actions .comment:hover:not(:disabled){background:#eaf1fe;color:var(--accent)}
    .change-head .actions .skip:hover{background:#ebebeb}
    .change-head .actions button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
    .change-head .complete{display:inline-flex;align-items:center;gap:6px;padding:0 8px;font-size:13px;font-weight:500;color:var(--accept)}
    .change-head .complete::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
    .change-head .actions .undo{margin-left:3px;padding:0 9px;font-weight:400;color:#525252}
    .change-head .actions .undo:hover:not(:disabled){background:#ebebeb}
    .change-head .actions .undo:disabled{color:#bdbdbd;opacity:1}
    .change-head .actions .accept:disabled,.change-head .actions .reject:disabled,.change-head .actions .comment:disabled{opacity:.4}
    /* Wider than a phone, a change has one compact header row: its number and
       place on the left, between the previous and next arrows; its status,
       the decisions and the change's own tools on the right. The bar's items
       join the header row directly. Undo appears once there is something to
       undo, Copy reference is a copy icon, and the position and "Review
       complete" are left to the toolbar's decided count. */
    @media(min-width:681px){
      .change-head{flex-wrap:wrap;align-items:center;gap:4px 6px;padding:5px 8px 5px 12px;min-height:40px}
      .change-head .dock,.change-head .actions{display:contents}
      .change-head .actions>.nav:first-child{order:1}.change-head .change-number{order:2}.change-head .actions>.nav:not(:first-child){order:3}
      .change-head .change-where{order:4;flex:1 1 120px;min-width:0;margin-left:4px}
      .change-head .change-kind,.change-head .badge{order:5}
      .change-head .actions>*{order:6}
      .change-head .link{order:7}
      .change-head .position,.change-head .complete{display:none}
      .change-head .actions .undo:disabled{display:none}
      .change-head .actions .nav{width:24px;height:26px;font-size:18px}
      .change-head .copy-reference{width:28px;padding:0;justify-content:center;font-size:0}
      .change-head .copy-reference::before{content:"";width:15px;height:15px;background:currentColor;-webkit-mask:var(--icon-copy) center/contain no-repeat;mask:var(--icon-copy) center/contain no-repeat}
    }
    #paper{--paper-top:14px;padding-top:14px}
    .review-body>#paper{padding-right:34px}
    .change-map{top:10px;bottom:10px;right:8px;width:14px;border:0;border-radius:0;background:none;box-shadow:none}
    .change-map::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;border-radius:2px;background:var(--line)}
    .change-map-viewport{left:50%;right:auto;width:4px;margin-left:-2px;border:0;border-radius:999px;background:rgb(24 24 27/.1);transition:width .15s,margin .15s,background-color .15s}
    .change-map:hover .change-map-viewport,.change-map-viewport:active{width:6px;margin-left:-3px;background:rgb(24 24 27/.2)}
    .change-map-mark{--mark:#b5b5b5;left:50%;width:4px;min-height:3px;margin-left:-2px;border-radius:999px;transition:width .15s,margin .15s}
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
      .change-head .actions{width:100%;flex-wrap:nowrap;justify-content:space-between;gap:4px;padding:5px;border-radius:16px;border-color:#d6d6d6;box-shadow:0 2px 4px rgb(0 0 0/.05),0 10px 28px rgb(0 0 0/.16)}
      .change-head .actions button{flex:1 1 auto;min-width:0;height:44px;gap:5px;padding:0 4px;border-radius:11px;font-size:14.5px}
      .change-head .actions .nav{flex:0 0 auto;width:28px;min-width:28px;padding:0}.change-head .position{min-width:30px;font-size:11.5px}
      .change-head .actions .undo{flex:0 0 auto;margin-left:0;padding:0 6px;font-size:14px}
      .composer{left:8px!important;right:8px!important;width:auto!important;max-width:none;bottom:70px;transform:none;max-height:calc(100% - 86px);overflow:auto}
      .composer textarea{font-size:16px;max-height:min(140px,30vh)}.composer button{min-height:44px}
      .side .pdf-strip,.context .pdf-strip{width:calc(100% * var(--pdf-reading-scale,1) * var(--pdf-crop-scale,1));margin-left:calc(-100% * var(--pdf-reading-scale,1) * var(--pdf-crop-scale,1) * var(--pdf-crop-shift,0))}
      [data-papilot-fit] .side,[data-papilot-fit] .context{overflow-x:hidden}
    }
    @media(max-width:480px){.bar .identity,.bar .meter{display:none}.bar .bar-end{gap:4px}}
    @media(max-width:400px){.change-head .position{display:none}}
    @media(max-width:370px){.change-head .actions .accept::before,.change-head .actions .reject::before,.change-head .actions .comment::before{display:none}}
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
