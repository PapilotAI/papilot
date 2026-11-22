import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NoteResult } from '../shared.ts';
import { InlineNoteBar, useNoteResults } from './note-results.tsx';
import { t } from './i18n.ts';

type ChipSlot = {
  unit: string;
  slot: HTMLElement;
  notes: NoteResult[];
};

type Place = {
  element: HTMLElement;
  slot: HTMLElement | null;
  activeNoteSlot: HTMLElement;
  chipSlots: ChipSlot[];
  unlinkedNotes: NoteResult[];
  notes: NoteResult[];
  activeUnit: string | null;
  cardState: string;
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
    const chipHosts = new Map<HTMLElement, { slot: HTMLElement; origTitle: string }>();
    const releaseChip = (chip: HTMLElement) => {
      const hosted = chipHosts.get(chip);
      if (!hosted) return;
      hosted.slot.remove();
      delete chip.dataset.papilotAnnotated;
      chip.title = hosted.origTitle;
      chipHosts.delete(chip);
    };
    const scan = () => {
      const shown = Number(doc.documentElement.dataset.papilotRound) || round;
      const next: Place[] = [];
      const activeChips = new Set<HTMLElement>();
      for (const element of doc.querySelectorAll<HTMLElement>('.change[data-stop]')) {
        const stop = Number(element.dataset.stop), units = element.dataset.units?.split(' ');
        const activeUnit = element.dataset.activeUnit || null;
        const cardState = element.dataset.state || 'pending';
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
        // On multi-edit cards, annotate the engine's unified .unit-chip buttons
        // directly so there is strictly ONE selector in the header and zero hidden edits.
        const chips = [...header.querySelectorAll<HTMLElement>('.unit-chip[data-unit]')];
        const chipSlots: ChipSlot[] = [];
        const coveredNoteKeys = new Set<string>();
        for (const chip of chips) {
          const unitId = chip.dataset.unit!;
          const matching = notes.filter(note =>
            note.changes.some(change => change.round === shown && change.units.includes(unitId)),
          );
          if (!matching.length) continue;
          activeChips.add(chip);
          let hosted = chipHosts.get(chip);
          if (!hosted) {
            const labelSlot = doc.createElement('span');
            labelSlot.className = 'papilot-chip-note';
            hosted = { slot: labelSlot, origTitle: chip.title };
            chipHosts.set(chip, hosted);
          }
          if (hosted.slot.parentElement !== chip) chip.append(hosted.slot);
          chip.dataset.papilotAnnotated = 'true';
          const noteTip = matching.map(n => `#${n.index + 1}: ${n.note.comment}`).join(' · ');
          chip.title = noteTip;
          for (const n of matching) coveredNoteKeys.add(n.key);
          chipSlots.push({ unit: unitId, slot: hosted.slot, notes: matching });
        }
        const unlinkedNotes = notes.filter(note => !coveredNoteKeys.has(note.key));
        if (unlinkedNotes.length) {
          if (pair.slot.parentElement !== header) header.append(pair.slot);
        } else if (pair.slot.parentElement) {
          pair.slot.remove();
        }
        if (pair.activeNoteSlot.parentElement !== element || pair.activeNoteSlot.previousElementSibling !== header) {
          header.after(pair.activeNoteSlot);
        }
        element.dataset.papilotHasNotes = 'true';
        next.push({
          element,
          slot: unlinkedNotes.length ? pair.slot : null,
          activeNoteSlot: pair.activeNoteSlot,
          chipSlots,
          unlinkedNotes,
          notes,
          activeUnit,
          cardState,
          isCurrent,
          stop,
          round: shown,
        });
      }
      for (const chip of [...chipHosts.keys()]) {
        if (!activeChips.has(chip) || !chip.isConnected) releaseChip(chip);
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
          place.cardState === next[i].cardState &&
          place.isCurrent === next[i].isCurrent &&
          place.chipSlots.length === next[i].chipSlots.length &&
          place.chipSlots.every((c, ci) =>
            c.slot === next[i].chipSlots[ci].slot &&
            c.unit === next[i].chipSlots[ci].unit &&
            c.notes.length === next[i].chipSlots[ci].notes.length &&
            c.notes.every((n, ni) => n === next[i].chipSlots[ci].notes[ni]),
          ) &&
          place.unlinkedNotes.length === next[i].unlinkedNotes.length &&
          place.unlinkedNotes.every((n, ni) => n === next[i].unlinkedNotes[ni]) &&
          place.notes.length === next[i].notes.length &&
          place.notes.every((note, n) => note === next[i].notes[n]),
        )
          ? previous
          : next,
      );
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-active-unit', 'data-state', 'class'] });
    doc.defaultView?.addEventListener('papilot:round', scan);
    return () => {
      observer.disconnect();
      doc.defaultView?.removeEventListener('papilot:round', scan);
      for (const chip of [...chipHosts.keys()]) releaseChip(chip);
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
      /* Keep sequential edit numbers (1, 2, 3, 4) visible on every chip, with a
         compact #note tag beside annotated edits; states use fills, borders and
         strikethrough instead of icon-only placeholders. */
      .papilot-chip-note{font-size:10px;font-weight:500;opacity:.78;letter-spacing:-.01em}
      .papilot-note-links{display:inline-flex;align-items:center;flex-wrap:nowrap;gap:4px;order:5;flex-shrink:0;padding:1px 0;background:transparent}
      .papilot-note-links>span{display:flex;gap:4px;min-width:0;max-width:140px;overflow-x:auto;scrollbar-width:none}
      .papilot-note-links>span::-webkit-scrollbar{display:none}
      .papilot-note-links button{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:22px;height:22px;padding:0 7px;border:1px dashed color-mix(in srgb,var(--text) 24%,transparent);border-radius:5px;background:transparent;color:var(--text-2);font:500 11.5px/20px var(--sans);font-variant-numeric:tabular-nums;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s}
      .papilot-note-links button:hover{color:var(--text);background:color-mix(in srgb,var(--text) 7%,transparent);border-color:color-mix(in srgb,var(--text) 38%,transparent)}
      .papilot-note-links button[data-state="pending"][data-unit-match="true"]{color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent);border-color:transparent;box-shadow:inset 0 0 0 1.5px var(--primary);font-weight:600}
      .papilot-note-links button[data-state="accepted"]{color:var(--green);background:color-mix(in srgb,var(--green) 15%,transparent);border:1px solid color-mix(in srgb,var(--green) 32%,transparent);font-weight:600}
      .papilot-note-links button[data-state="accepted"][data-unit-match="true"]{border-color:transparent;box-shadow:inset 0 0 0 1.5px var(--green)}
      .papilot-note-links button[data-state="rejected"]{color:var(--red);background:color-mix(in srgb,var(--red) 12%,transparent);border:1px solid color-mix(in srgb,var(--red) 30%,transparent);text-decoration:line-through;text-decoration-thickness:1.25px}
      .papilot-note-links button[data-state="rejected"][data-unit-match="true"]{border-color:transparent;box-shadow:inset 0 0 0 1.5px var(--red);font-weight:600}
      .papilot-note-links button[data-state="commented"]{color:var(--accent);background:color-mix(in srgb,var(--accent) 15%,transparent);border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);border-bottom-width:2px}
      .papilot-note-links button[data-state="commented"][data-unit-match="true"]{border-color:transparent;box-shadow:inset 0 0 0 1.5px var(--accent);font-weight:600}
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
        .papilot-note-links button{min-height:30px;min-width:28px;padding:0 8px}
        .papilot-inline-tab{height:30px;padding:0 10px;font-size:12px}
        .note-return-toggle,.papilot-inline-close{width:32px;height:32px}
      }
    `}</style>, doc.head)}
    {places.flatMap(place =>
      place.chipSlots.map(chip =>
        createPortal(
          <>{chip.notes.map(n => `#${n.index + 1}`).join(',')}</>,
          chip.slot,
          `chip:${place.round}:${place.stop}:${chip.unit}`,
        ),
      ),
    )}
    {places.map(place => {
      if (!place.slot || !place.unlinkedNotes.length) return null;
      return createPortal(
        <span>
          {place.unlinkedNotes.map(note => (
            <button
              key={note.key}
              type="button"
              title={note.note.comment}
              data-state={place.cardState}
              data-unit-match={place.isCurrent ? 'true' : undefined}
              aria-label={t('Show note {n}: {comment}', { n: note.index + 1, comment: note.note.comment })}
              onClick={event => { event.stopPropagation(); focusAt(place, note); }}
            >
              <span className="papilot-note-num">#{note.index + 1}</span>
            </button>
          ))}
        </span>,
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
