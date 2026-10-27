type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Message = { text: string; requestKey: string };

export const reviewInstructions = 'Address the comments from this review round. Preserve accepted changes and do not reintroduce rejected edits.';

// Keep the submission identity separate from text being edited while a request
// is in flight. Feedback is its own submission and never consumes the draft.
export class ComposerDraft {
  text: string;
  sending = false;
  sendingSource: 'draft' | 'feedback' | null = null;
  private revision = 0;
  private requestKeys: Record<'draft' | 'feedback', string>;
  private listeners = new Set<() => void>();
  private snapshot: { text: string; sending: boolean; sendingSource: 'draft' | 'feedback' | null };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private changed() { this.snapshot = { text: this.text, sending: this.sending, sendingSource: this.sendingSource }; for (const listener of this.listeners) listener(); }

  constructor(private key: string, private storage: DraftStorage, private newId: () => string) {
    this.text = storage.getItem(key) || '';
    this.requestKeys = { draft: newId(), feedback: newId() };
    this.snapshot = { text: this.text, sending: this.sending, sendingSource: this.sendingSource };
  }

  edit(text: string) {
    this.text = text;
    this.revision++;
    this.requestKeys.draft = this.newId();
    this.storage.setItem(this.key, text);
    this.changed();
  }

  async submit(source: 'draft' | 'feedback', send: (message: Message) => Promise<unknown>): Promise<boolean> {
    const text = source === 'draft' ? this.text : reviewInstructions;
    if (this.sending || !text.trim()) return false;
    this.sending = true; this.sendingSource = source;
    this.changed();
    const revision = this.revision;
    try {
      await send({ text: text.trim(), requestKey: this.requestKeys[source] });
      if (source === 'draft' && this.revision === revision) {
        // A task can be reopened while its previous request is still pending.
        // Preserve a newer draft saved by that mounted composer or another tab.
        const saved = this.storage.getItem(this.key);
        if (saved === text || saved === null) {
          this.text = '';
          this.storage.removeItem(this.key);
        } else this.text = saved;
      }
      if (source === 'feedback' || this.revision === revision) this.requestKeys[source] = this.newId();
      return true;
    } finally {
      this.sending = false; this.sendingSource = null;
      this.changed();
    }
  }
}

// New tasks start from a single prompt, like a chat. The sidebar title is its
// first line, shortened at a word boundary.
export function taskTitle(text: string) {
  const line = (text.split('\n').find(value => value.trim()) || '').replace(/^[\s#>*+-]+/, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!line) return 'Untitled task';
  if (line.length <= 80) return line;
  const cut = line.slice(0, 80), space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '') + '…';
}

type SendKey = { key: string; keyCode?: number; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing: boolean };
// Enter sends from a hardware keyboard and Shift+Enter adds a line. Touch
// keyboards have no Shift+Enter, so Enter adds a line there. Command/Ctrl+Enter
// always sends. Safari reports the Enter that confirms IME input as keyCode 229.
export function sendsMessage(event: SendKey, touch: boolean) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false;
  return event.metaKey || event.ctrlKey || (!touch && !event.shiftKey && !event.altKey);
}
