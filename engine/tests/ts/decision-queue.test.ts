import { it, expect } from "vitest";
import { DecisionQueue, Unreachable, withQueued, type QueuedDecision } from "../../src/web/decision-queue.ts";

const entry = (id: string, changes = [id], kind: QueuedDecision["kind"] = "accept"): QueuedDecision =>
  ({ id, kind, round: 1, changes, body: "" });
function gate<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// A queue whose requests wait for the test to answer them, one by one.
function fixture(retries = 4) {
  const sent: { entry: QueuedDecision; answer: ReturnType<typeof gate<string>> }[] = [],
    events: string[] = [];
  const queue = new DecisionQueue<QueuedDecision, string>({
    send: (decision) => {
      const answer = gate<string>();
      sent.push({ entry: decision, answer });
      return answer.promise;
    },
    confirmed: (decision, reply, remaining) =>
      events.push(`confirmed ${decision.id} ${reply} [${remaining.map((r) => r.id)}]`),
    failed: (decision, error, dropped) =>
      events.push(`failed ${decision.id} ${error.message} [${dropped.map((d) => d.id)}]`),
    retries,
    delay: async () => {},
  });
  return { queue, sent, events };
}

it("sends fast successive decisions one at a time, in order, and confirms each in turn", async () => {
  const { queue, sent, events } = fixture();
  queue.push(entry("a"));
  queue.push(entry("b"));
  queue.push(entry("c"));
  await tick();
  expect(queue.pending.map((e) => e.id)).toEqual(["a", "b", "c"]);
  expect(sent.map((s) => s.entry.id)).toEqual(["a"]);
  sent[0].answer.resolve("state-a");
  await tick();
  expect(sent.map((s) => s.entry.id)).toEqual(["a", "b"]);
  expect(events).toEqual(["confirmed a state-a [b,c]"]);
  sent[1].answer.resolve("state-b");
  await tick();
  queue.push(entry("d"));
  sent[2].answer.resolve("state-c");
  await tick();
  sent[3].answer.resolve("state-d");
  await queue.drained();
  expect(sent.map((s) => s.entry.id)).toEqual(["a", "b", "c", "d"]);
  expect(events).toEqual([
    "confirmed a state-a [b,c]",
    "confirmed b state-b [c]",
    "confirmed c state-c [d]",
    "confirmed d state-d []",
  ]);
  expect(queue.pending).toEqual([]);
});

it("a failure mid-queue stops it and hands back the later decisions unsent", async () => {
  const { queue, sent, events } = fixture();
  for (const id of ["a", "b", "c", "d"]) queue.push(entry(id));
  await tick();
  sent[0].answer.resolve("state-a");
  await tick();
  sent[1].answer.reject(new Error("b can't be applied"));
  await queue.drained();
  expect(sent.map((s) => s.entry.id)).toEqual(["a", "b"]);
  expect(events).toEqual(["confirmed a state-a [b,c,d]", "failed b b can't be applied [c,d]"]);
  expect(queue.pending).toEqual([]);
  // The queue runs again for the next decision.
  queue.push(entry("e"));
  await tick();
  expect(sent.at(-1)!.entry.id).toBe("e");
  sent.at(-1)!.answer.resolve("state-e");
  await queue.drained();
  expect(events.at(-1)).toBe("confirmed e state-e []");
});

it("retries a request that may not have arrived with the same identity, and never retries a refusal", async () => {
  const { queue, sent, events } = fixture(2);
  queue.push(entry("a"));
  await tick();
  sent[0].answer.reject(new Unreachable("Failed to fetch"));
  await tick();
  sent[1].answer.reject(new Unreachable("Papilot is restarting"));
  await tick();
  sent[2].answer.resolve("state-a");
  await queue.drained();
  expect(sent.map((s) => s.entry)).toEqual([entry("a"), entry("a"), entry("a")]);
  expect(new Set(sent.map((s) => s.entry.id))).toEqual(new Set(["a"]));
  expect(events).toEqual(["confirmed a state-a []"]);

  queue.push(entry("b"));
  queue.push(entry("c"));
  await tick();
  sent[3].answer.reject(new Error("These changes were already decided."));
  await queue.drained();
  expect(sent.length).toBe(4);
  expect(events.at(-1)).toBe("failed b These changes were already decided. [c]");

  // After the last retry the decision is handed back as failed.
  queue.push(entry("d"));
  for (let attempt = 0; attempt < 3; attempt++) {
    await tick();
    sent.at(-1)!.answer.reject(new Unreachable("Failed to fetch"));
  }
  await queue.drained();
  expect(sent.slice(4).map((s) => s.entry.id)).toEqual(["d", "d", "d"]);
  expect(events.at(-1)).toBe("failed d Failed to fetch []");
});

it("waiting for the queue to drain, as undo does, settles only after every confirmation or a failure", async () => {
  const { queue, sent } = fixture();
  await queue.drained();
  queue.push(entry("a"));
  queue.push(entry("b"));
  let drained = false;
  const waiting = queue.drained().then(() => { drained = true; });
  await tick();
  sent[0].answer.resolve("state-a");
  await tick();
  expect(drained).toBe(false);
  sent[1].answer.resolve("state-b");
  await waiting;
  expect(drained).toBe(true);

  queue.push(entry("c"));
  queue.push(entry("d"));
  const stopped = queue.drained();
  await tick();
  sent[2].answer.reject(new Error("refused"));
  await stopped;
  expect(sent.map((s) => s.entry.id)).toEqual(["a", "b", "c"]);
});

it("shows queued decisions over the confirmed ones until they are confirmed", () => {
  const confirmed = { a: "pending", b: "pending", c: "accepted", d: "pending" } as const;
  expect(withQueued(confirmed, [])).toBe(confirmed);
  expect(withQueued(confirmed, [
    entry("a"),
    entry("b", ["b"], "reject"),
    entry("c", ["c"], "unstage"),
    entry("d", ["d", "missing"], "comment"),
  ])).toEqual({ a: "accepted", b: "rejected", c: "pending", d: "commented" });
  expect(confirmed.a).toBe("pending");
});
