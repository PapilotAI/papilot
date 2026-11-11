import { Compartment, EditorState, RangeSet, StateEffect, StateField, Text, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Chunk } from '@codemirror/merge';
import { tags } from '@lezer/highlight';

// The LaTeX editor of the manuscript's source tab, loaded when a source is
// first opened. It shows the whole file, with bars beside the lines that
// changed since the last commit and their places along the scrollbar. In a
// task, it also shows the review's changes in the text, each with Accept and
// Reject, as an editor shows an agent's edits.

export type ChangeKind = 'added' | 'modified' | 'deleted';
export interface SourceEditorOptions {
  parent: HTMLElement; label: string;
  onChange: () => void; onSave: () => void;
  /** Escape outside the search panel; returns whether it was used. */
  onEscape: () => boolean;
  /** The main cursor moved to another line (0-based) by the author. */
  onCursor?: (line: number) => void;
  /** A change bar was clicked, at a line (0-based) of its change. */
  onChangeBar?: (line: number) => void;
  /** Accept or Reject was pressed on a review change shown in the text. */
  onDecide?: (change: string, action: 'accept' | 'reject') => void;
  labels?: { accept: string; reject: string };
}

/** A change of a review, in the text: each part's range in the document and
 *  the text it replaced. */
export interface ReviewChange { id: string; decision: string; parts: { from: number; to: number; old: string }[] }

const latex = StreamLanguage.define(stex);
// The colours of the review's LaTeX, for light and dark pages.
const highlight = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--latex-command)' },
  { tag: tags.keyword, color: 'var(--latex-math)' },
  { tag: tags.number, color: 'var(--latex-math)' },
  { tag: tags.bracket, color: 'var(--latex-bracket)' },
  { tag: tags.atom, color: 'var(--latex-parameter)' },
  { tag: tags.comment, color: 'var(--latex-comment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--text)', backgroundColor: 'var(--bg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7' },
  '.cm-content': { padding: '6px 0 40vh', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 16px 0 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '1.5px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--text-3)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '34px', padding: '0 6px 0 10px', fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)', outline: 'none' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--amber, #d79b00) 28%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--amber, #d79b00) 55%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--text)', borderColor: 'var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel.cm-search': { padding: '6px 10px', fontFamily: 'var(--sans)', fontSize: '12.5px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--sans)', fontSize: '12.5px' },
  '.cm-textfield': { border: '1px solid var(--line)', borderRadius: '6px', backgroundColor: 'var(--bg)', color: 'var(--text)', padding: '3px 6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '6px', color: 'var(--text)', padding: '3px 8px' },
  // The lines a click on the PDF named, and lines shown briefly.
  '.cm-source-focus': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-source-word': { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)', borderRadius: '2px' },
  // What changed since the last commit, beside the line numbers and along the scrollbar.
  // A review's changes in the text, and Accept and Reject after each.
  '.cm-review-added': { backgroundColor: 'var(--green-soft)', borderRadius: '2px' },
  '.cm-review-removed': { backgroundColor: 'var(--red-soft)', color: 'var(--danger)', textDecoration: 'line-through', textDecorationColor: 'color-mix(in srgb, var(--danger) 55%, transparent)', borderRadius: '2px', whiteSpace: 'pre-wrap' },
  '.cm-review-dropped': { color: 'var(--text-3)', textDecoration: 'line-through' },
  '.cm-review-restored': { backgroundColor: 'var(--green-soft)', borderRadius: '2px', whiteSpace: 'pre-wrap' },
  '.cm-review-actions': { display: 'inline-flex', gap: '2px', margin: '0 2px 0 4px', verticalAlign: '-3px' },
  '.cm-review-actions > button': { display: 'inline-grid', placeItems: 'center', width: '20px', height: '18px', padding: '0', border: '1px solid var(--line)', borderRadius: '5px', backgroundColor: 'var(--bg)', cursor: 'pointer' },
  '.cm-review-actions > button:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-review-actions svg': { width: '12px', height: '12px' },
  '.cm-review-accept': { color: 'var(--green)' },
  '.cm-review-reject': { color: 'var(--danger)' },
  '.cm-change-ruler': { position: 'absolute', top: '0', right: '0', bottom: '0', zIndex: '3', pointerEvents: 'none' },
  '.cm-ruler-mark': { position: 'absolute', left: '1px', right: '1px', borderRadius: '1px' },
  '.cm-ruler-added': { backgroundColor: 'var(--green, #2f9e44)' },
  '.cm-ruler-modified': { backgroundColor: 'var(--accent)' },
  '.cm-ruler-deleted': { backgroundColor: 'var(--danger)' },
  '.cm-change-bars': { width: '6px', marginRight: '2px' },
  '.cm-change-bars .cm-gutterElement': { position: 'relative', padding: '0', cursor: 'pointer' },
  '.cm-change-bar': { position: 'absolute', top: '0', bottom: '0', left: '1px', right: '1px' },
  '.cm-change-first': { top: '1px', borderTopLeftRadius: '1px', borderTopRightRadius: '1px' },
  '.cm-change-last': { bottom: '1px', borderBottomLeftRadius: '1px', borderBottomRightRadius: '1px' },
  '.cm-change-added': { backgroundColor: 'var(--green, #2f9e44)' },
  '.cm-change-modified': { backgroundColor: 'var(--accent)' },
  // A deletion has no lines left: a short mark where they were.
  '.cm-change-deleted': { top: '-1.5px', bottom: 'auto', height: '3px', backgroundColor: 'var(--danger)' },
});

// The focus: lines named by a click on the PDF or a change in the Changes
// view, and within them the words picked on the PDF, until the text is edited.
const setFocus = StateEffect.define<{ lines: [number, number][]; word?: [number, number] }>();
const focusField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFocus)) {
      const doc = tr.state.doc, lines = new Set<number>(), word = effect.value.word;
      for (const [from, to] of effect.value.lines) for (let line = from; line < Math.max(to, from + 1) && line < doc.lines; line++) lines.add(line);
      const marks = [...lines].sort((a, b) => a - b).map(line => Decoration.line({ class: 'cm-source-focus' }).range(doc.line(line + 1).from));
      if (word && word[1] > word[0] && word[1] <= doc.length) marks.push(Decoration.mark({ class: 'cm-source-word' }).range(word[0], word[1]));
      return Decoration.set(marks, true);
    }
    return tr.docChanged ? Decoration.none : value;
  },
  provide: field => EditorView.decorations.from(field),
});

// A flash: lines shown briefly, as the PDF marks a place it shows.
const setFlash = StateEffect.define<[number, number][]>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setFlash)) {
      const doc = tr.state.doc, lines = new Set<number>();
      for (const [from, to] of effect.value) for (let line = from; line < Math.max(to, from + 1) && line < doc.lines; line++) lines.add(line);
      return Decoration.set([...lines].sort((a, b) => a - b).map(line => Decoration.line({ class: 'cm-source-flash' }).range(doc.line(line + 1).from)));
    }
    return value.map(tr.changes);
  },
  provide: field => EditorView.decorations.from(field),
});

// One line's part of a change's bar: the bars of a change's lines join into
// one rounded mark, drawn like the marks along the scrollbar.
class ChangeBar extends GutterMarker {
  constructor(readonly name: string) { super(); }
  eq(other: ChangeBar) { return other.name === this.name; }
  toDOM() { const bar = document.createElement('div'); bar.className = this.name; return bar; }
}
const bars = new Map<string, ChangeBar>();
const bar = (kind: ChangeKind, first: boolean, last: boolean) => {
  const name = `cm-change-bar cm-change-${kind}${first ? ' cm-change-first' : ''}${last ? ' cm-change-last' : ''}`;
  if (!bars.has(name)) bars.set(name, new ChangeBar(name));
  return bars.get(name)!;
};

/** Lines (0-based, end excluded) that differ from `base`, by kind. A deletion
 *  is an empty range at the line after it. */
export function changedLines(base: Text, doc: Text, chunks = Chunk.build(base, doc)) {
  return chunks.map(chunk => {
    const kind: ChangeKind = chunk.fromA === chunk.toA ? 'added' : chunk.fromB === chunk.toB ? 'deleted' : 'modified';
    const from = doc.lineAt(Math.min(chunk.fromB, doc.length)).number - 1;
    const to = kind === 'deleted' ? from : doc.lineAt(Math.max(chunk.fromB, Math.min(chunk.toB, doc.length + 1) - 1)).number;
    return { kind, from, to };
  });
}

// Where changes are in the whole file, along the scrollbar: one mark per
// change at its height in the document, like an editor's overview ruler.
// It only shows; the scrollbar beneath it keeps working.
function changeRuler(changes: (view: EditorView) => ReturnType<typeof changedLines>) {
  return ViewPlugin.fromClass(class {
    dom = document.createElement('div');
    constructor(readonly view: EditorView) {
      this.dom.className = 'cm-change-ruler';
      this.dom.setAttribute('aria-hidden', 'true');
      view.dom.appendChild(this.dom);
      this.draw();
    }
    update(update: ViewUpdate) { if (update.docChanged || update.geometryChanged || update.heightChanged) this.draw(); }
    draw() {
      const view = this.view;
      view.requestMeasure({
        read: () => {
          const doc = view.state.doc, scroller = view.scrollDOM, height = Math.max(scroller.scrollHeight, 1), top = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
          return {
            width: Math.max(6, scroller.offsetWidth - scroller.clientWidth),
            marks: changes(view).map(change => {
              const start = view.lineBlockAt(doc.line(Math.min(change.from + 1, doc.lines)).from);
              const end = change.kind === 'deleted' ? start : view.lineBlockAt(doc.line(Math.min(Math.max(change.to, change.from + 1), doc.lines)).from);
              return { kind: change.kind, top: (start.top + top) / height, bottom: (change.kind === 'deleted' ? start.top + top : end.bottom + top) / height };
            }),
          };
        },
        write: ({ width, marks }) => {
          this.dom.style.width = `${width}px`;
          this.dom.replaceChildren(...marks.map(mark => {
            const element = document.createElement('div');
            element.className = `cm-ruler-mark cm-ruler-${mark.kind}`;
            element.style.top = `${(mark.top * 100).toFixed(3)}%`;
            element.style.height = `max(3px, ${((mark.bottom - mark.top) * 100).toFixed(3)}%)`;
            return element;
          }));
        },
      });
    }
    destroy() { this.dom.remove(); }
  });
}

// Bars beside the lines that changed since the last commit, and their marks
// along the scrollbar, kept up to date as the author types.
function changeBars(base: Text, onClick?: (line: number) => void): Extension {
  const chunks = StateField.define<readonly Chunk[]>({
    create: state => Chunk.build(base, state.doc),
    update: (value, tr) => tr.docChanged ? Chunk.updateB(value, base, tr.newDoc, tr.changes) : value,
  });
  return [chunks, changeRuler(view => changedLines(base, view.state.doc, view.state.field(chunks))), gutter({
    class: 'cm-change-bars',
    markers: view => {
      const doc = view.state.doc, marks: { from: number; marker: GutterMarker }[] = [];
      for (const change of changedLines(base, doc, view.state.field(chunks))) {
        if (change.kind === 'deleted') marks.push({ from: doc.line(Math.min(change.from + 1, doc.lines)).from, marker: bar('deleted', true, true) });
        else for (let line = change.from; line < change.to; line++) marks.push({ from: doc.line(line + 1).from, marker: bar(change.kind, line === change.from, line === change.to - 1) });
      }
      return RangeSet.of(marks.map(mark => mark.marker.range(mark.from)), true);
    },
    domEventHandlers: { mousedown: (view, line) => { onClick?.(view.state.doc.lineAt(line.from).number - 1); return Boolean(onClick); } },
  })];
}

// The review's changes, kept at their places as the author types. A pending
// change shows what it removed, struck through before what it wrote, and
// Accept and Reject after it; an accepted one is plain text again; a
// rejected one shows the text that comes back until the file is reread.
const setReview = StateEffect.define<ReviewChange[]>();
const setDecisions = StateEffect.define<Map<string, string>>();
class RemovedText extends WidgetType {
  constructor(readonly text: string, readonly restored: boolean) { super(); }
  eq(other: RemovedText) { return other.text === this.text && other.restored === this.restored; }
  toDOM() {
    const element = document.createElement('span');
    element.className = this.restored ? 'cm-review-restored' : 'cm-review-removed';
    element.textContent = this.text;
    return element;
  }
}
class ChangeActions extends WidgetType {
  constructor(readonly id: string, readonly options: SourceEditorOptions) { super(); }
  eq(other: ChangeActions) { return other.id === this.id; }
  toDOM() {
    const element = document.createElement('span');
    element.className = 'cm-review-actions';
    for (const action of ['accept', 'reject'] as const) {
      const button = document.createElement('button'), label = this.options.labels?.[action] ?? action;
      button.type = 'button'; button.className = `cm-review-${action}`; button.title = label; button.setAttribute('aria-label', label);
      button.innerHTML = action === 'accept'
        ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
      // The caret stays where it was.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => this.options.onDecide?.(this.id, action));
      element.append(button);
    }
    return element;
  }
  ignoreEvent() { return true; }
}
function reviewDecorations(changes: ReviewChange[], options: SourceEditorOptions) {
  const ranges = [];
  for (const change of changes) {
    if (change.decision === 'accepted') continue;
    const rejected = change.decision === 'rejected';
    for (const part of change.parts) {
      if (part.old) ranges.push(Decoration.widget({ widget: new RemovedText(part.old, rejected), side: -1 }).range(part.from));
      if (part.to > part.from) ranges.push(Decoration.mark({ class: rejected ? 'cm-review-dropped' : 'cm-review-added' }).range(part.from, part.to));
    }
    if (change.decision === 'pending' && change.parts.length)
      ranges.push(Decoration.widget({ widget: new ChangeActions(change.id, options), side: 1 }).range(Math.max(...change.parts.map(part => part.to))));
  }
  return Decoration.set(ranges, true);
}
const reviewField = (options: SourceEditorOptions) => StateField.define<ReviewChange[]>({
  create: () => [],
  update(changes, tr) {
    for (const effect of tr.effects) if (effect.is(setReview)) return effect.value;
    let next = changes;
    if (tr.docChanged && next.length) next = next.map(change => ({ ...change, parts: change.parts.map(part => {
      const from = tr.changes.mapPos(part.from, 1);
      return { ...part, from, to: Math.max(from, tr.changes.mapPos(part.to, -1)) };
    }) }));
    for (const effect of tr.effects) if (effect.is(setDecisions)) next = next.map(change => ({ ...change, decision: effect.value.get(change.id) ?? change.decision }));
    return next;
  },
  provide: field => EditorView.decorations.from(field, changes => reviewDecorations(changes, options)),
});

export class SourceCodeEditor {
  readonly view: EditorView;
  private bars = new Compartment();
  private editable = new Compartment();
  private base = Text.empty;
  private silent = false;
  private review: ReturnType<typeof reviewField>;
  // The version whose review changes are shown.
  private reviewKey: string | null = null;

  constructor(private options: SourceEditorOptions) {
    this.review = reviewField(options);
    this.view = new EditorView({ parent: options.parent, state: this.state('') });
  }

  private state(text: string) {
    const options = this.options;
    return EditorState.create({ doc: text, extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(),
      search({ top: false }), highlightSelectionMatches(), latex, syntaxHighlighting(highlight), EditorView.lineWrapping, theme,
      this.editable.of(EditorState.readOnly.of(false)), this.bars.of(changeBars(this.base, options.onChangeBar)), focusField, flashField, this.review,
      EditorView.contentAttributes.of({ 'aria-label': options.label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => { options.onSave(); return true; } },
        { key: 'Mod-Enter', preventDefault: true, run: () => { options.onSave(); return true; } },
        ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
        { key: 'Escape', run: () => options.onEscape() },
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged && !this.silent) options.onChange();
        if (options.onCursor && update.selectionSet && !this.silent && update.transactions.some(tr => tr.isUserEvent('select') || tr.isUserEvent('input') || tr.isUserEvent('delete')))
          options.onCursor(update.state.doc.lineAt(update.state.selection.main.head).number - 1);
      }),
    ] });
  }

  get text() { return this.view.state.doc.toString(); }

  /** Shows a file, with a fresh undo history, beside its last commit. */
  load(text: string, base: string | null) {
    this.base = Text.of((base ?? '').split('\n'));
    if (base === null) this.base = Text.empty;
    this.silent = true;
    try { this.view.setState(this.state(text)); } finally { this.silent = false; }
    this.reviewKey = null;
  }

  /** Shows a review's changes in the text. `key` names the version of the
   *  file they were found in, `text`: they are placed only over that text,
   *  then follow the author's edits, and while the key stays only their
   *  decisions change. */
  showReview(review: { key: string; text: string; changes: ReviewChange[] } | null) {
    if (!review) {
      if (this.reviewKey !== null) { this.reviewKey = null; this.view.dispatch({ effects: setReview.of([]) }); }
      return;
    }
    if (review.key === this.reviewKey) {
      this.view.dispatch({ effects: setDecisions.of(new Map(review.changes.map(change => [change.id, change.decision]))) });
      return;
    }
    if (this.view.state.doc.toString() !== review.text) return;
    this.reviewKey = review.key;
    this.view.dispatch({ effects: setReview.of(review.changes) });
  }

  /** The last commit changed, such as after a commit. */
  setBase(base: string | null) {
    this.base = base === null ? Text.empty : Text.of(base.split('\n'));
    this.view.dispatch({ effects: this.bars.reconfigure(changeBars(this.base, this.options.onChangeBar)) });
  }

  /** Replaces the whole text as one edit, which the author can undo. */
  replace(text: string) { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, userEvent: 'input.replace' }); }

  setReadOnly(readOnly: boolean) { this.view.dispatch({ effects: this.editable.reconfigure(EditorState.readOnly.of(readOnly)) }); }

  /** Scrolls lines into view, a third down the editor, puts the caret at
   *  their start (or at `word`, characters picked within them) and, with
   *  `mark`, highlights them (or the `marks` within them) and the word until
   *  the text changes. */
  reveal([from, to]: [number, number], { mark = false, caret = true, marks, word, smooth = false }: { mark?: boolean; caret?: boolean; marks?: [number, number][]; word?: [number, number]; smooth?: boolean } = {}) {
    const view = this.view, doc = view.state.doc, first = doc.line(Math.min(Math.max(from, 0), doc.lines - 1) + 1);
    const picked = word && word[1] <= doc.length ? word : undefined, at = picked ? picked[0] : first.from;
    const margin = Math.round(view.scrollDOM.clientHeight / 3);
    this.silent = true;
    try {
      view.dispatch({
        ...(caret ? { selection: { anchor: at } } : {}),
        effects: [setFocus.of({ lines: mark ? marks ?? [[from, Math.max(to, from + 1)]] : [], word: mark ? picked : undefined }),
          ...(smooth ? [] : [EditorView.scrollIntoView(at, { y: 'start', yMargin: margin })])],
      });
    } finally { this.silent = false; }
    // Gliding to a place in a file already open keeps the reader oriented.
    if (smooth) view.scrollDOM.scrollTo({ top: Math.max(0, view.lineBlockAt(at).top - margin), behavior: 'smooth' });
  }

  /** Shows lines briefly, as the PDF marks a place. A flash starts over
   *  when one is still showing. */
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  flash(ranges: [number, number][]) {
    clearTimeout(this.flashTimer);
    this.view.dispatch({ effects: setFlash.of([]) });
    requestAnimationFrame(() => {
      if (!this.view.dom.isConnected) return;
      this.view.dispatch({ effects: setFlash.of(ranges) });
      this.flashTimer = setTimeout(() => { if (this.view.dom.isConnected) this.view.dispatch({ effects: setFlash.of([]) }); }, 1100);
    });
  }

  focus() { this.view.focus(); }

  destroy() { clearTimeout(this.flashTimer); this.view.destroy(); }
}
