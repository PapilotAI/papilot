import type { Decision } from "../types.ts";

export type QueuedKind = "accept" | "reject" | "comment" | "unstage";
/** A decision the review shows at once and sends after the earlier ones. */
export interface QueuedDecision {
  /** The same for every attempt, so the engine applies a retried decision once. */
  id: string;
  kind: QueuedKind;
  round: number;
  changes: string[];
  body: string;
}
const DECIDED: Record<QueuedKind, Decision> = {
  accept: "accepted",
  reject: "rejected",
  comment: "commented",
  unstage: "pending",
};
/** The decisions as they will be once every queued one is confirmed. */
export function withQueued(
  decisions: Record<string, Decision>,
  queued: readonly QueuedDecision[],
): Record<string, Decision> {
  if (!queued.length) return decisions;
  const result = { ...decisions };
  for (const entry of queued)
    for (const id of entry.changes) if (id in result) result[id] = DECIDED[entry.kind];
  return result;
}
/** A request that may not have reached the server, which can be sent again. */
export class Unreachable extends Error {}
const wait = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));

/**
 * Sends decisions one at a time, in the order they were made. A confirmation
 * arrives for each in turn. When one fails, the queue stops: that decision and
 * every later one are handed back together, none of them sent, so the review
 * never shows a decision the server did not take.
 */
export class DecisionQueue<T extends QueuedDecision, R> {
  private entries: T[] = [];
  private running = false;
  private idle: (() => void)[] = [];
  constructor(
    private options: {
      send: (entry: T) => Promise<R>;
      /** Each confirmation, with the decisions still queued after it. */
      confirmed: (entry: T, reply: R, remaining: readonly T[]) => void;
      /** The decision that failed, why, and the later ones that were not sent. */
      failed: (entry: T, error: Error, dropped: T[]) => void;
      /** Requests that may not have arrived are sent again this often. */
      retries?: number;
      delay?: (attempt: number) => Promise<void>;
    },
  ) {}
  get pending(): readonly T[] {
    return this.entries;
  }
  push(entry: T) {
    this.entries = [...this.entries, entry];
    void this.run();
  }
  /** Settles once every queued decision is confirmed or the queue stopped. */
  drained(): Promise<void> {
    return this.running || this.entries.length
      ? new Promise((resolve) => this.idle.push(resolve))
      : Promise.resolve();
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.entries.length) {
        const entry = this.entries[0];
        let reply: R;
        try {
          reply = await this.attempt(entry);
        } catch (error) {
          const dropped = this.entries.slice(1);
          this.entries = [];
          this.options.failed(entry, error instanceof Error ? error : new Error(String(error)), dropped);
          break;
        }
        this.entries = this.entries.slice(1);
        this.options.confirmed(entry, reply, this.entries);
      }
    } finally {
      this.running = false;
      for (const resolve of this.idle.splice(0)) resolve();
    }
  }
  private async attempt(entry: T): Promise<R> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.options.send(entry);
      } catch (error) {
        if (!(error instanceof Unreachable) || attempt >= (this.options.retries ?? 4))
          throw error;
        await (this.options.delay ?? wait)(attempt);
      }
    }
  }
}
