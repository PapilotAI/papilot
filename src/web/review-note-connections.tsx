import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteResult } from '../shared.ts';
import { InlineNoteBar, useNoteResults } from './note-results.tsx';
import { Icon } from './icons.tsx';
import { t } from './i18n.ts';

type Place = {
  element: HTMLElement;
  slot: HTMLElement;
  activeNoteSlot: HTMLElement;
  notes: NoteResult[];
  activeUnit: string | null;
  isCurrent: boolean;
  stop: number;
  round: number;
};

export function ReviewNoteConnections({ doc, round }: { doc: Document | null; round: number }) {
  const links = useNoteResults(), latest = useRef(links); latest.current = links;
  const [places, setPlaces] = useState<Place[]>([]);
  const jumped = useRef<{ doc: Document; sequence: number } | null>(null);

  useEffect(() => {
    if (!doc || !links) return;
    const slots = new Map<HTMLElement, { slot: HTMLElement; activeNoteSlot: HTMLElement }>();
    const scan = () => {
      const shown = Number(doc.documentElement.dataset.papilotRound) || round;
      const next: Place[] = [];
      for (const element of doc.querySelectorAll<HTMLElement>('.change[data-stop]')) {
        const stop = Number(element.dataset.stop), units = element.dataset.units?.split(' ');
        const activeUnit = element.dataset.activeUnit || null;
        const isCurrent = element.classList.contains('current');
        const notes = links.notes.filter(note =>
          note.changes.some(change => change.round === shown && (units ? change.units.some(id => units.includes(id)) : change.stop === stop)),
        );
        const header = element.querySelector<HTMLElement>('.change-head');
        if (!notes.length || !header) continue;
        let pair = slots.get(element);
        if (!pair) {
          const slot = doc.createElement('span'), activeNoteSlot = doc.createElement('div');
          slot.className = 'papilot-note-links'; activeNoteSlot.className = 'papilot-unit-notes';
          pair = { slot, activeNoteSlot }; slots.set(element, pair);
        }
        if (pair.slot.parentElement !== header) header.append(pair.slot);
        if (pair.activeNoteSlot.parentElement !== element || pair.activeNoteSlot.previousElementSibling !== header) {
          header.after(pair.activeNoteSlot);
        }
        element.dataset.papilotHasNotes = 'true';
        next.push({ element, ...pair, notes, activeUnit, isCurrent, stop, round: shown });
      }
      for (const [element, pair] of slots) {
        if (!next.some(place => place.element === element)) {
          delete element.dataset.papilotHasNotes;
          pair.slot.remove(); pair.activeNoteSlot.remove(); slots.delete(element);
        }
      }
      setPlaces(previous =>
        previous.length === next.length &&
        previous.every((place, i) =>
          place.slot === next[i].slot &&
          place.element === next[i].element &&
          place.round === next[i].round &&
          place.activeUnit === next[i].activeUnit &&
          place.isCurrent === next[i].isCurrent &&
          place.notes.length === next[i].notes.length &&
          place.notes.every((note, n) => note === next[i].notes[n]),
        )
          ? previous
          : next,
      );
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active-unit', 'class'] });
    doc.defaultView?.addEventListener('papilot:round', scan);
    return () => {
      observer.disconnect();
      doc.defaultView?.removeEventListener('papilot:round', scan);
      slots.forEach((pair, element) => { delete element.dataset.papilotHasNotes; pair.slot.remove(); pair.activeNoteSlot.remove(); });
    };
  }, [doc, links?.notes, round]);

  // Clicking a note in Chat or in the card header scrolls to that change card
  // and focuses that exact sub-unit without popping up a bottom drawer.
  useEffect(() => {
    const focus = links?.focus;
    if (!doc || !focus || (jumped.current?.doc === doc && jumped.current.sequence === focus.sequence)) return;
    const place = places.find(place => place.round === focus.change.round && place.stop === focus.change.stop && place.notes.some(note => note.key === focus.key));
    if (!place) return;
    const unit = focus.change.units[0];
    doc.defaultView?.dispatchEvent(new CustomEvent('papilot:select-unit', { detail: { stop: place.stop, unit } }));
    const paper = doc.getElementById('paper');
    if (paper) {
      const padding = parseFloat(doc.defaultView?.getComputedStyle(paper).scrollPaddingTop || '') || 0;
      paper.scrollBy({ top: place.element.getBoundingClientRect().top - paper.getBoundingClientRect().top - padding - 12, behavior: 'instant' });
    }
    place.element.focus({ preventScroll: true });
    jumped.current = { doc, sequence: focus.sequence };
  }, [doc, places, links?.focus]);

  // Forward active inline alternative-option previews to the review iframe so
  // the card's own PDF strip swaps in place without leaving FullPaper.
  useEffect(() => {
    const target = doc?.defaultView;
    if (!target) return;
    const send = () => {
      const current = latest.current;
      const preview = current?.preview;
      const note = preview ? current.notes.find(n => n.key === preview.key) : undefined;
      const units = note ? [...new Set(note.changes.filter(c => c.round === preview!.round).flatMap(c => c.units))] : [];
      target.dispatchEvent(new CustomEvent('papilot:option-preview', {
        detail: preview ? { key: preview.key, round: preview.round, units, detail: preview.detail, busy: preview.busy } : null,
      }));
      target.dispatchEvent(new CustomEvent('papilot:note-focus', { detail: null }));
    };
    send();
    target.addEventListener('papilot:round', send);
    target.addEventListener('papilot:note-focus-ready', send);
    return () => {
      target.removeEventListener('papilot:round', send);
      target.removeEventListener('papilot:note-focus-ready', send);
    };
  }, [doc, round, links?.preview, links?.notes]);

  if (!doc || !links) return null;

  const focusAt = (place: Place, note: NoteResult) => {
    const change = note.changes.find(c => c.round === place.round && c.stop === place.stop);
    const unit = change?.units[0];
    doc.defaultView?.dispatchEvent(new CustomEvent('papilot:select-unit', { detail: { stop: place.stop, unit } }));
    if (change) latest.current?.showChange(note.key, change);
    else latest.current?.focusNote(note.key);
  };

  return <>
    {createPortal(<style>{`
      /* Cards with linked annotations use the annotation switcher as the single
         selector in the header, hiding the redundant ‹ 1 / N › counter. */
      .change[data-papilot-has-notes="true"] :is(.unit-focus-step,.unit-focus-pos,.unit-focus-sep){display:none}
      .papilot-note-links{display:inline-flex;align-items:center;flex-wrap:nowrap;gap:2px;order:5;flex-shrink:0;padding:0 2px;background:transparent}
      .papilot-note-links>svg{flex:none;margin-right:2px;color:var(--text-3)}
      .papilot-note-links>span{display:flex;gap:2px;min-width:0;max-width:128px;overflow-x:auto;scrollbar-width:thin}
      .papilot-note-links button{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:22px;height:22px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--text-2);font:500 11.5px/1 var(--sans);font-variant-numeric:tabular-nums;cursor:pointer;transition:background-color .15s,color .15s}
      .papilot-note-links button:hover{color:var(--text);background:color-mix(in srgb,var(--text) 7%,transparent)}
      .papilot-note-links button[data-unit-match=true]{color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,transparent);font-weight:600}
      .papilot-note-links button:focus-visible{outline:2px solid var(--primary);outline-offset:-1px}
      .papilot-unit-notes{display:flex;flex-direction:column;gap:6px;padding:7px 12px 6px;border-bottom:1px solid var(--line);background:var(--bg-subtle,var(--bg));font:12px/1.45 var(--sans);color:var(--text-2)}
      :root[data-papilot-reader] .change.inline .papilot-unit-notes{padding-right:22px}
      :root[data-papilot-reader][data-papilot-phone] .change.inline .papilot-unit-notes{padding-right:16px}
      .papilot-unit-notes:empty{display:none}
      .reviewed-change>.papilot-unit-notes{display:none}
      .papilot-inline-note{display:flex;flex-direction:column;gap:4px;min-width:0}
      .papilot-inline-note-main{display:flex;align-items:baseline;gap:6px;min-width:0}
      .papilot-unit-note-num{flex:none;color:var(--primary);font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums}
      .papilot-unit-note-text{flex:1 1 auto;min-width:0;color:var(--text);word-break:break-word}
      .papilot-inline-options{display:flex;flex-direction:column;gap:4px;padding-left:20px;margin-top:2px}
      .papilot-inline-tabs{display:flex;align-items:center;flex-wrap:wrap;gap:14px;border-bottom:1px solid var(--line)}
      .papilot-inline-tab{position:relative;display:inline-flex;align-items:center;gap:5px;padding:3px 0 5px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--text-3);font:450 12px/1.3 var(--sans);white-space:nowrap;cursor:pointer;transition:color .15s,border-color .15s}
      .papilot-inline-tab:hover:not(:disabled){color:var(--text)}
      .papilot-inline-tab[aria-selected=true]{color:var(--primary);font-weight:500;border-bottom-color:var(--primary)}
      .papilot-inline-tab:focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:2px}
      .papilot-inline-tab:disabled{opacity:.45;cursor:default}
      .papilot-inline-note-detail{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}
      .papilot-inline-reason{flex:1 1 200px;min-width:0;font-size:11.5px;color:var(--text-3)}
      .papilot-inline-close:focus-visible,.note-return-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:1px}
      .papilot-inline-comment{display:flex;align-items:flex-start;gap:6px;flex:1 1 100%;margin-top:2px}
      .papilot-inline-comment textarea{flex:1 1 auto;min-width:0;padding:5px 8px;border:1px solid var(--line-strong,var(--line));border-radius:5px;background:var(--bg);color:var(--text);font:12px/1.4 var(--sans);resize:vertical}
      .papilot-inline-close,.note-return-toggle{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--text-2);cursor:pointer}
      .papilot-inline-close:hover,.note-return-toggle:hover{background:var(--bg-muted);color:var(--text)}
      .note-return-toggle[data-returned=true]{color:var(--primary);background:var(--accent-soft)}
      .note-disposition{display:inline-flex;align-items:center;margin-left:auto;flex:none}
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .papilot-inline-error,.note-return-error{font-size:11.5px;color:var(--red)}
      .papilot-inline-error button{margin-left:6px;padding:1px 6px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--text);font:inherit;cursor:pointer}
      .papilot-inline-hint{font-size:11.5px;color:var(--text-3)}
      .papilot-inline-spinner{display:inline-block;width:10px;height:10px;border:1.5px solid currentColor;border-top-color:transparent;border-radius:50%;animation:papilot-spin .6s linear infinite}
      @keyframes papilot-spin{to{transform:rotate(360deg)}}
      @media(pointer:coarse){
        .papilot-note-links button{min-height:32px;min-width:28px}
        .papilot-inline-tab{height:30px;padding:0 10px;font-size:12px}
        .note-return-toggle,.papilot-inline-close{width:32px;height:32px}
      }
    `}</style>, doc.head)}
    {places.map(place => {
      const unitMatch = (note: NoteResult) => Boolean(
        place.isCurrent && (
          place.activeUnit
            ? note.changes.some(change => change.round === place.round && change.units.includes(place.activeUnit!))
            : true
        ),
      );
      return createPortal(
        <>
          <Icon name="notes" size={12}/>
          <span>
            {place.notes.map(note => (
              <button
                key={note.key}
                type="button"
                title={note.note.comment}
                data-unit-match={unitMatch(note) ? 'true' : undefined}
                aria-label={t('Show note {n}: {comment}', { n: note.index + 1, comment: note.note.comment })}
                onClick={event => { event.stopPropagation(); focusAt(place, note); }}
              >
                {note.index + 1}
              </button>
            ))}
          </span>
        </>,
        place.slot,
        `${place.round}:${place.stop}`,
      );
    })}
    {places.map(place => {
      if (!place.isCurrent) return createPortal(null, place.activeNoteSlot, `active-note:${place.round}:${place.stop}`);
      const matching = place.activeUnit
        ? place.notes.filter(note => note.changes.some(change => change.round === place.round && change.units.includes(place.activeUnit!)))
        : place.notes;
      return createPortal(
        matching.length ? <>{matching.map(note => <InlineNoteBar key={note.key} note={note}/>)}</> : null,
        place.activeNoteSlot,
        `active-note:${place.round}:${place.stop}`,
      );
    })}
  </>;
}
