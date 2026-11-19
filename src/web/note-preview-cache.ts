interface Entry<T> {
  promise: Promise<T>; value?: T; ready?: boolean; foreground: boolean;
  start?: () => void; promote?: () => void;
}

/** Share in-flight comparisons and decoded results across note switches. */
export class NotePreviewCache<T> {
  private entries = new Map<string, Entry<T>>();
  private queue: Entry<T>[] = [];
  private background?: Entry<T>;
  constructor(private limit = 24) {}
  peek(key: string) { return this.entries.get(key)?.value; }
  read(key: string, load: (background: boolean) => Promise<T>, promote?: () => void): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key); this.entries.set(key, cached);
      if (!promote && !cached.ready) {
        cached.foreground = true;
        // A queued choice starts directly in the foreground. One already
        // loading only needs to raise the existing engine work's priority.
        const raise = cached.start || cached.promote; delete cached.promote; raise?.();
      }
      return cached.promise;
    }
    let start!: () => void;
    const entry: Entry<T> = { foreground: !promote, promote, promise: new Promise<T>((resolve, reject) => {
      start = () => {
        delete entry.start;
        void Promise.resolve().then(() => load(!entry.foreground)).then(resolve, reject);
      };
    }) };
    entry.start = start;
    this.entries.set(key, entry);
    entry.promise = entry.promise.then(value => {
      entry.value = value; entry.ready = true; delete entry.promote;
      // Never evict unfinished work: a later selection must still join it.
      let completed = [...this.entries.values()].filter(entry => entry.ready).length;
      for (const [key, entry] of this.entries) {
        if (completed <= this.limit) break;
        if (entry.ready) { this.entries.delete(key); completed--; }
      }
      return value;
    }, error => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }).finally(() => {
      if (this.background === entry) this.background = undefined;
      this.drain();
    });
    if (promote) { this.queue.push(entry); this.drain(); }
    else start();
    return entry.promise;
  }
  private drain() {
    // Long HTTP/1.1 prefetches must leave connections for decisions, state
    // reads and foreground previews, including across drawer navigation.
    if (this.background) return;
    while (this.queue.length) {
      const entry = this.queue.shift()!;
      if (!entry.start) continue;
      this.background = entry; entry.start(); return;
    }
  }
}
