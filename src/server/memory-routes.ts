import type { FastifyInstance } from 'fastify';
import type { MemoryScope, MemorySuggestion, TimelineItem } from '../shared.ts';
import type { Store } from './store.ts';
import { Memory, memoryRule, ruleKey } from './memory.ts';
import { MEMORY_LEARNING, MEMORY_SINCE, dismissedKey } from './memory-learning.ts';

// Literal errors, so the error catalog translates them for the author.
const fail = (error: Error, statusCode = 400): never => { throw Object.assign(error, { statusCode }); };
const learning = (store: Store) => store.preference<boolean>(MEMORY_LEARNING) !== false;

// changed(projectId) tells the manuscript view to read Git again: a shared
// rule is a new or changed repository file, though the PDF stays the same.
export function registerMemoryRoutes(app: FastifyInstance, store: Store, memory: () => Memory, changed: (projectId: string) => void = () => undefined) {
  function paper(id: unknown) {
    if (id === undefined || id === null || id === '') return undefined;
    if (typeof id !== 'string' || id.length > 64) throw new Error('Select a valid paper.');
    return store.project(id).path;
  }
  const catalog = (projectId: unknown) => memory().catalog(paper(projectId), learning(store));
  const written = async (projectId: unknown) => {
    if (typeof projectId === 'string' && projectId) changed(projectId);
    return catalog(projectId);
  };
  type Body = { projectId?: string; scope?: unknown; text?: unknown; previous?: unknown; to?: unknown; revision?: unknown; revisions?: { from?: unknown; to?: unknown }; enabled?: unknown };
  app.get<{ Querystring: { projectId?: string } }>('/api/memory', request => catalog(request.query.projectId));
  app.post<{ Body: Body }>('/api/memory/add', async request => {
    const b = request.body || {};
    await memory().add(b.scope, b.text, paper(b.projectId), { revision: b.revision });
    return written(b.projectId);
  });
  app.post<{ Body: Body }>('/api/memory/update', async request => {
    const b = request.body || {};
    await memory().update(b.scope, b.previous, b.text, b.revision, paper(b.projectId));
    return written(b.projectId);
  });
  app.post<{ Body: Body }>('/api/memory/remove', async request => {
    const b = request.body || {};
    await memory().remove(b.scope, b.text, b.revision, paper(b.projectId));
    return written(b.projectId);
  });
  app.post<{ Body: Body }>('/api/memory/move', async request => {
    const b = request.body || {};
    await memory().move(b.scope, b.to, b.text, b.revisions || {}, paper(b.projectId));
    return written(b.projectId);
  });
  app.post<{ Body: Body }>('/api/memory/learning', async request => {
    const b = request.body || {};
    if (typeof b.enabled !== 'boolean') fail(new Error('Choose whether Papilot learns from reviews.'));
    // Learning resumes with what happens next, not the reviews made while it was off.
    if (b.enabled && !learning(store)) store.savePreference(MEMORY_SINCE, Date.now());
    store.savePreference(MEMORY_LEARNING, b.enabled);
    return catalog(b.projectId);
  });

  // A suggestion card in a task: Remember saves the (edited) rule where the
  // author chose, Dismiss keeps it from being proposed again, Undo reverses
  // exactly what Remember did. One action per task at a time, each reading
  // the card afresh, so two clicks never overwrite each other's result.
  const cards = new Map<string, Promise<unknown>>();
  function serial<T>(taskId: string, work: () => Promise<T>) {
    const next = (cards.get(taskId) || Promise.resolve()).then(work, work);
    const settled = next.catch(() => undefined);
    cards.set(taskId, settled);
    void settled.then(() => { if (cards.get(taskId) === settled) cards.delete(taskId); });
    return next;
  }
  type Action = { action?: unknown; text?: unknown; scope?: unknown };
  app.post<{ Params: { id: string; suggestion: string }; Body: Action }>('/api/tasks/:id/memory/:suggestion', { config: { resource: { task: 'id' } } }, request => serial(request.params.id, async () => {
    const task = store.task(request.params.id), b = request.body || {};
    const item = store.items(task.id).find(entry => entry.type === 'memory' && entry.memory?.some(suggestion => suggestion.id === request.params.suggestion));
    if (!item) return fail(new Error('This suggestion is no longer available.'), 404);
    const root = store.project(task.projectId).path, suggestion = item.memory!.find(entry => entry.id === request.params.suggestion)!;
    let next: MemorySuggestion;
    if (b.action === 'save') {
      if (suggestion.status === 'saved') return item;
      const scope = (b.scope ?? suggestion.scope) as MemoryScope, text = memoryRule(b.text ?? suggestion.text);
      // The rule it refines goes away wherever it is, so the two never contradict.
      const from = suggestion.replaces ? await memory().find(suggestion.replaces, root) : undefined;
      const { added, replaced } = await memory().add(scope, text, root, from === scope ? { replaces: suggestion.replaces } : {});
      let removed: string | undefined;
      if (from && from !== scope && await memory().remove(from, suggestion.replaces, undefined, root)) removed = suggestion.replaces;
      const gone = replaced ?? removed;
      next = { ...suggestion, status: 'saved', saved: { scope, text, ...(added ? {} : { existing: true as const }), ...(gone ? { replaced: gone, replacedScope: from } : {}) } };
    } else if (b.action === 'dismiss') {
      if (suggestion.status !== 'pending') return item;
      for (const key of [dismissedKey(task.projectId), ...(suggestion.scope === 'personal' ? [dismissedKey()] : [])]) {
        const dismissed = store.preference<string[]>(key) || [];
        if (!dismissed.includes(ruleKey(suggestion.text))) store.savePreference(key, [...dismissed, ruleKey(suggestion.text)]);
      }
      next = { ...suggestion, status: 'dismissed' };
    } else if (b.action === 'undo') {
      if (suggestion.status !== 'saved' || !suggestion.saved) return item;
      const { scope, text, existing, replaced, replacedScope } = suggestion.saved;
      if (!memory().has(scope, text, root)) fail(new Error('This preference changed after it was saved. Edit it in Settings → Memory.'), 409);
      // A rule that was already saved before stays; only what Remember changed is reversed.
      if (replaced && replacedScope === scope && !existing) await memory().add(scope, replaced, root, { replaces: text });
      else {
        if (!existing) await memory().remove(scope, text, undefined, root);
        if (replaced && replacedScope) await memory().add(replacedScope, replaced, root);
      }
      const { saved: _, ...pending } = suggestion;
      next = { ...pending, status: 'pending' };
    } else return fail(new Error('Choose Remember, Dismiss or Undo.'));
    const current = store.items(task.id).find(entry => entry.id === item.id) || item;
    const updated: TimelineItem = { ...current, memory: (current.memory || []).map(entry => entry.id === next.id ? next : entry) };
    store.saveItem(updated);
    if (b.action !== 'dismiss') changed(task.projectId);
    return updated;
  }));
}
