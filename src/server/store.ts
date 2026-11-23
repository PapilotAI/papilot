import type { ReviewSnapshot } from './ai-review.ts';
import { backfillActivity, type ActivityEventInput, type ActivityEventKind, type ActivityEventRow } from './activity.ts';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Annotation, Project, Task, Run, TimelineItem } from '../shared.ts';

// A thread's task, through the task_threads index.
export const TASK_BY_THREAD = "SELECT data FROM tasks WHERE json_extract(data,'$.threadId')=? ORDER BY rowid LIMIT 1";

// The navigation count spans every root document of a paper. The partial
// index keeps frequent state reads independent of the historical task notes.
const onManuscript = `json_extract(data, '$.taskId') IS NULL AND json_extract(data, '$.deletedAt') IS NULL
  AND (json_extract(data, '$.aiReview') IS NULL OR NULLIF(json_extract(data, '$.aiReview.sourceId'), '') IS NOT NULL)`;

export class Store extends EventEmitter {
  db: DatabaseSync;
  constructor(public readonly file: string) {
    super();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS task_pins(task_id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_tasks(id TEXT PRIMARY KEY, deleted INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_review_inputs(task_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS manuscript_notes_by_project ON annotations(project_id) WHERE ${onManuscript};
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS anchor_sources(project_id TEXT NOT NULL, revision TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(project_id, revision));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activity_events(key TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, project_id TEXT, task_id TEXT, agent TEXT, model TEXT, undone_at INTEGER, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS activity_events_at ON activity_events(at);
      CREATE INDEX IF NOT EXISTS activity_events_project ON activity_events(project_id, at);
      CREATE INDEX IF NOT EXISTS task_items ON items(task_id,created);
      CREATE INDEX IF NOT EXISTS task_runs ON runs(task_id,status);
      CREATE INDEX IF NOT EXISTS task_threads ON tasks(json_extract(data,'$.threadId'));`);
    // Keep the host's settings when upgrading a formerly shared workspace.
    // Papers, tasks, notes and historical attribution stay intact; credentials
    // and invitations are removed together so they cannot be reused.
    this.transaction(() => {
      const tables = new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
      if (tables.has('users') && tables.has('preferences')) this.db.exec(`
        INSERT OR IGNORE INTO settings SELECT p.key, p.data FROM preferences p
        JOIN users u ON u.id=p.user_id WHERE json_extract(u.data, '$.role')='owner';`);
      for (const table of ['credentials', 'invites', 'sessions', 'members', 'preferences', 'users', 'migrations']) this.db.exec(`DROP TABLE IF EXISTS ${table}`);
      backfillActivity(this);
    });
  }
  private rows<T>(table: string): T[] { return (this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  projects() { return this.rows<Project>('projects'); }
  findProject(id: string) { const row = this.db.prepare('SELECT data FROM projects WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as Project : undefined; }
  manuscriptNoteCounts(): Record<string, number> {
    const counts = this.db.prepare(`SELECT project_id, COUNT(*) AS total FROM annotations WHERE ${onManuscript} GROUP BY project_id`).all();
    return Object.fromEntries(counts.map(row => [String(row.project_id), Number(row.total)]));
  }
  tasks() { return this.rows<Task>('tasks'); }
  pinnedTaskIds() {
    return (this.db.prepare('SELECT task_id FROM task_pins ORDER BY rowid').all() as { task_id: string }[]).map(row => row.task_id);
  }
  setTaskPinned(id: string, pinned: boolean) {
    this.task(id);
    // Pin order follows insertion. Task updates leave this record alone.
    const result = pinned
      ? this.db.prepare('INSERT OR IGNORE INTO task_pins VALUES(?)').run(id)
      : this.db.prepare('DELETE FROM task_pins WHERE task_id=?').run(id);
    if (result.changes) this.emit('change');
  }
  runs() { return this.rows<Run>('runs'); }
  project(id: string) { const v = this.projects().find(p => p.id === id); if (!v) throw new Error('Paper project not found.'); return v; }
  task(id: string) { const task = this.findTask(id); if (!task) throw new Error('Task not found.'); return task; }
  // Agents stream several events a second, each naming its thread; reading
  // every task (archived ones too) for each of them grew with the history.
  findTask(id: string) { const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) as Task : undefined; }
  taskProject(id: string) { return (this.db.prepare('SELECT project_id FROM tasks WHERE id=?').get(id) as { project_id: string } | undefined)?.project_id; }
  taskByThread(threadId: unknown) {
    if (typeof threadId !== 'string' || !threadId) return undefined;
    const row = this.db.prepare(TASK_BY_THREAD).get(threadId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as Task : undefined;
  }
  projectByPath(p: string) { return this.projects().find(project => project.path === p); }
  saveProject(p: Project) { this.db.prepare('INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,data=excluded.data').run(p.id, p.path, JSON.stringify(p)); this.emit('change'); }
  removeProject(id: string) {
    this.project(id);
    const tasks = (this.db.prepare('SELECT id FROM tasks WHERE project_id=?').all(id) as { id: string }[]).map(row => row.id);
    this.transaction(() => {
      // Only Papilot records are removed. Never finish review tasks or touch their files.
      this.db.prepare('INSERT OR IGNORE INTO deleted_tasks SELECT id, ? FROM tasks WHERE project_id=?').run(Date.now(), id);
      for (const table of ['items', 'runs', 'ai_review_inputs', 'task_pins']) this.db.prepare(`DELETE FROM ${table} WHERE task_id IN (SELECT id FROM tasks WHERE project_id=?)`).run(id);
      for (const task of tasks) { const prefix = `note-options:${task}:`; this.db.prepare('DELETE FROM settings WHERE substr(key,1,?)=?').run(prefix.length, prefix); }
      const clearPrefix = `annotation-clear:${id}:`;
      this.db.prepare('DELETE FROM settings WHERE substr(key,1,?)=?').run(clearPrefix.length, clearPrefix);
      for (const table of ['tasks', 'annotations', 'anchor_sources']) this.db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
      this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
    });
    for (const task of tasks) this.itemRevisions.delete(task);
    this.emit('change');
  }
  preference<T>(key: string) { const row = this.db.prepare('SELECT data FROM settings WHERE key=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) as T : undefined; }
  // One durable copy per revision, shared by all anchors made in that file.
  saveAnchorSource(projectId: string, revision: string, text: string) {
    this.db.prepare('INSERT OR IGNORE INTO anchor_sources VALUES(?,?,?)').run(projectId, revision, text);
  }
  anchorSource(projectId: string, revision: string) {
    return (this.db.prepare('SELECT text FROM anchor_sources WHERE project_id=? AND revision=?').get(projectId, revision) as { text: string } | undefined)?.text;
  }
  savePreference(key: string, value: unknown) {
    if (value === undefined) this.db.prepare('DELETE FROM settings WHERE key=?').run(key);
    else this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data').run(key, JSON.stringify(value));
  }
  saveTask(t: Task) { t.updatedAt = Date.now(); this.db.prepare('INSERT INTO tasks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, data=excluded.data').run(t.id, t.projectId, JSON.stringify(t)); this.emit('change'); return t; }
  updateTask(id: string, update: Partial<Task>) { return this.saveTask({ ...this.task(id), ...update }); }
  saveRun(r: Run) { this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(r.id, r.taskId, r.requestKey, r.status, JSON.stringify(r)); this.emit('change'); }
  runByKey(key: string) { const row = this.db.prepare('SELECT data FROM runs WHERE request_key=?').get(key) as { data: string } | undefined; return row ? JSON.parse(row.data) as Run : undefined; }
  items(taskId: string) { return (this.db.prepare('SELECT data FROM items WHERE task_id=? ORDER BY created,rowid').all(taskId) as { data: string }[]).map(r => JSON.parse(r.data) as TimelineItem); }
  // One message of a conversation that can hold megabytes of command output.
  item(taskId: string, id: string) { const row = this.db.prepare('SELECT data FROM items WHERE id=? AND task_id=?').get(id, taskId) as { data: string } | undefined; return row ? JSON.parse(row.data) as TimelineItem : undefined; }
  // A running task's view reads its timeline every second, and a command's
  // output alone can be 40 KB, so a view that has the timeline asks only for
  // the items written since its revision. Revisions start over with the
  // process; one from an earlier run gets the whole timeline.
  private readonly boot = randomUUID().slice(0, 8);
  private revision = 0;
  private itemRevisions = new Map<string, Map<string, number>>();
  itemsSince(taskId: string, since?: string): { items: TimelineItem[]; revision: string; partial?: true } {
    const revision = `${this.boot}:${this.revision}`, match = /^([0-9a-f]{8}):(\d{1,15})$/.exec(since || ''), after = match ? Number(match[2]) : NaN;
    if (!match || match[1] !== this.boot || after > this.revision) return { items: this.items(taskId), revision };
    const changed = [...this.itemRevisions.get(taskId) || []].filter(([, at]) => at > after).map(([id]) => id);
    if (changed.length > 500) return { items: this.items(taskId), revision };
    const items = changed.length ? (this.db.prepare(`SELECT data FROM items WHERE task_id=? AND id IN (${changed.map(() => '?').join()}) ORDER BY created,rowid`).all(taskId, ...changed) as { data: string }[]).map(r => JSON.parse(r.data) as TimelineItem) : [];
    return { items, revision, partial: true };
  }
  saveItem(item: TimelineItem) {
    this.db.prepare('INSERT INTO items VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, item.taskId, item.createdAt, JSON.stringify(item));
    let revisions = this.itemRevisions.get(item.taskId);
    if (!revisions) this.itemRevisions.set(item.taskId, revisions = new Map());
    revisions.set(item.id, ++this.revision);
    this.emit('change');
  }
  saveReviewInput(taskId: string, snapshot: ReviewSnapshot) { this.db.prepare('INSERT INTO ai_review_inputs VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET data=excluded.data').run(taskId, JSON.stringify(snapshot)); }
  reviewInput(taskId: string): ReviewSnapshot {
    const row = this.db.prepare('SELECT data FROM ai_review_inputs WHERE task_id=?').get(taskId) as { data: string } | undefined;
    if (!row) throw new Error('The PDF snapshot for this review is unavailable. Start a new AI review.');
    return JSON.parse(row.data);
  }
  annotations(projectId: string, deleted = false) { return (this.db.prepare('SELECT data FROM annotations WHERE project_id=? ORDER BY rowid').all(projectId) as { data: string }[]).map(r => JSON.parse(r.data) as Annotation).filter(note => deleted || note.deletedAt === undefined); }
  findAnnotation(projectId: string, id: string) {
    const row = this.db.prepare('SELECT data FROM annotations WHERE id=? AND project_id=?').get(id, projectId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as Annotation : undefined;
  }
  annotation(projectId: string, id: string) {
    const note = this.findAnnotation(projectId, id);
    if (!note) throw new Error('Note not found.');
    return note;
  }
  saveAnnotation(a: Annotation) { this.db.prepare('INSERT INTO annotations VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(a.id, a.projectId, JSON.stringify(a)); this.emit('change'); return a; }
  returnAnnotation(copy: Annotation, decision?: string) {
    const existing = this.findAnnotation(copy.projectId, copy.id), replay = copy.returnReplay;
    if (existing && ((decision && existing.returnDecisions?.includes(decision)) || (replay && existing.returnReplays?.includes(replay)))) return existing;
    const returnReplays = replay ? [...(existing?.returnReplays ?? []), replay] : existing?.returnReplays;
    if (existing && (existing.taskId || (existing.deletedAt === undefined && !decision))) {
      return replay ? this.saveAnnotation({ ...existing, returnReplays }) : existing;
    }
    const note = existing ?? copy, active = existing && existing.deletedAt === undefined;
    return this.restoreAnnotation({ ...note, returnReplays,
      returnAction: active ? existing.returnAction : copy.returnAction,
      returnReplay: active ? existing.returnReplay : replay,
      createdAt: existing?.deletedAt !== undefined ? Math.max(copy.createdAt, existing.createdAt + 1) : note.createdAt,
      ...(decision ? { returnDecisions: [...(note.returnDecisions ?? []), decision] } : {}) });
  }
  reviewReturns(projectId: string, taskId: string, action: string) {
    return this.annotations(projectId, true).filter(note => !note.taskId && note.returnAction?.taskId === taskId && note.returnAction.id === action);
  }
  deleteAnnotation(projectId: string, id: string) {
    const note = this.annotation(projectId, id);
    if (note.taskId) throw new Error('This note has already been sent.');
    if (note.deletedAt !== undefined) return;
    const { deletedBatch: _, ...active } = note;
    this.saveAnnotation({ ...active, deletedAt: Date.now() });
  }
  restoreAnnotation(note: Annotation) {
    const { deletedAt: _, deletedBatch: _batch, ...active } = note;
    return this.saveAnnotation(active);
  }
  taskDeleted(id: string) { return Boolean(this.db.prepare('SELECT 1 FROM deleted_tasks WHERE id=?').get(id)); }
  deleteTask(id: string) {
    this.transaction(() => {
      this.db.prepare('INSERT INTO deleted_tasks VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(id, Date.now());
      this.db.prepare('DELETE FROM items WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM runs WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM ai_review_inputs WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM task_pins WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
      const prefix = `note-options:${id}:`; this.db.prepare('DELETE FROM settings WHERE substr(key,1,?)=?').run(prefix.length, prefix);
    });
    this.itemRevisions.delete(id);
    this.emit('change');
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  recover() {
    this.transaction(() => {
      for (const t of this.tasks().filter(t => t.titleGeneration === 'pending')) this.updateTask(t.id, { titleGeneration: 'failed' });
      for (const t of this.tasks().filter(t => t.status === 'deleting')) this.updateTask(t.id, { error: 'The server restarted during deletion. Retry deletion to confirm cleanup.' });
      for (const t of this.tasks().filter(t => t.pendingReview)) this.updateTask(t.id, { status: 'uncertain', error: 'The server restarted before a review action was confirmed. Select Check status before continuing.' });
      for (const r of this.runs().filter(r => r.status === 'running')) {
        const finishedAt = Date.now();
        this.saveRun({ ...r, status: 'interrupted', finishedAt });
        const task = this.findTask(r.taskId);
        this.recordActivity({ key: `turn:${r.id}`, at: r.createdAt, kind: 'agent_turn', projectId: task?.projectId, taskId: r.taskId, agent: task?.agent || 'codex', model: task?.model, data: { role: task?.mode === 'review' ? 'review' : 'edit', status: 'interrupted', finishedAt } }, true);
      }
      for (const t of this.tasks().filter(t => ['running', 'waiting_input'].includes(t.status) || (t.mode === 'review' && t.status === 'building'))) this.updateTask(t.id, { status: 'interrupted', turnId: null, error: 'The server restarted and interrupted the previous turn. Continue in the same conversation.' });
    });
  }
  // Durable workspace statistics stay independent of live state broadcasts and
  // survive later task or paper cleanup.
  recordActivity(event: ActivityEventInput, upsert = false) {
    const sql = upsert
      ? `INSERT INTO activity_events VALUES(?,?,?,?,?,?,?,NULL,?)
         ON CONFLICT(key) DO UPDATE SET
           at=CASE WHEN activity_events.undone_at IS NOT NULL OR excluded.kind='review_decision' THEN excluded.at ELSE activity_events.at END,
           agent=COALESCE(excluded.agent, activity_events.agent),
           model=COALESCE(excluded.model, activity_events.model),
           undone_at=NULL,
           data=excluded.data`
      : 'INSERT OR IGNORE INTO activity_events VALUES(?,?,?,?,?,?,?,NULL,?)';
    this.db.prepare(sql).run(
      event.key,
      Math.round(event.at),
      event.kind,
      event.projectId ?? null,
      event.taskId ?? null,
      event.agent ?? null,
      event.model ?? null,
      JSON.stringify(event.data),
    );
  }
  undoActivity(key: string, undoneAt = Date.now()) {
    return this.db.prepare('UPDATE activity_events SET undone_at=? WHERE key=? AND undone_at IS NULL').run(Math.round(undoneAt), key).changes > 0;
  }
  // Removes an event and returns it, so a reversible action can put it back.
  clearActivity(key: string): ActivityEventRow | null {
    const event = this.activityEvent(key);
    this.db.prepare('DELETE FROM activity_events WHERE key=?').run(key);
    return event;
  }
  activityEvent(key: string): ActivityEventRow | null {
    const row = this.db.prepare(`${ACTIVITY_COLUMNS} WHERE key=?`).get(key) as ActivityRow | undefined;
    return row ? activityEventRow(row) : null;
  }
  activityEvents(projectId?: string): ActivityEventRow[] {
    const rows = (projectId
      ? this.db.prepare(`${ACTIVITY_COLUMNS} WHERE project_id=? ORDER BY at ASC, rowid ASC`).all(projectId)
      : this.db.prepare(`${ACTIVITY_COLUMNS} ORDER BY at ASC, rowid ASC`).all()) as ActivityRow[];
    return rows.map(activityEventRow);
  }
  close() { this.db.close(); }
}

const ACTIVITY_COLUMNS = 'SELECT key, at, kind, project_id, task_id, agent, model, undone_at, data FROM activity_events';
type ActivityRow = { key: string; at: number; kind: ActivityEventKind; project_id: string | null; task_id: string | null; agent: string | null; model: string | null; undone_at: number | null; data: string };
const activityEventRow = (row: ActivityRow): ActivityEventRow => ({
  key: row.key,
  at: Number(row.at),
  kind: row.kind,
  projectId: row.project_id,
  taskId: row.task_id,
  agent: row.agent,
  model: row.model,
  undoneAt: row.undone_at === null ? null : Number(row.undone_at),
  data: JSON.parse(row.data),
});
