import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { SourceFile, TaskSourceSave } from '../../../src/shared.ts';
import type { SourceLocation } from '../../../src/host-events.ts';
import type { RuntimeClient } from './runtime-client.ts';

export function taskUri(location: SourceLocation) {
  return vscode.Uri.from({ scheme: 'papilot-task', authority: location.projectId, path: `/${location.taskId}/${location.file}` });
}
export function taskLocation(uri: vscode.Uri): SourceLocation {
  const [, taskId, ...parts] = uri.path.split('/');
  if (uri.scheme !== 'papilot-task' || !uri.authority || !taskId || !parts.length) throw vscode.FileSystemError.FileNotFound(uri);
  return { projectId: uri.authority, taskId, file: parts.join('/'), lines: [0, 1] };
}

/** Task saves must pass through Papilot's revision checks and review publishing.
 * The filesystem provider translates editor IO; it does not write worktrees. */
export class TaskFiles implements vscode.FileSystemProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;
  private loaded = new Map<string, SourceFile>();
  private pending = new Map<string, { id: string; text: string; revision: string }>();
  private stamps = new Map<string, { revision: string; time: number }>();
  private timer: ReturnType<typeof setInterval>;
  private polling = false;
  constructor(private runtime: () => Promise<RuntimeClient>, private saved: (location: SourceLocation, state: unknown) => void) {
    this.timer = setInterval(() => void this.poll(), 2000);
  }
  private async read(uri: vscode.Uri) {
    const { taskId, file } = taskLocation(uri);
    return (await this.runtime()).request<SourceFile>(`/tasks/${encodeURIComponent(taskId!)}/source?file=${encodeURIComponent(file)}`);
  }
  private stamp(uri: vscode.Uri, source: SourceFile) {
    const key = uri.toString(), previous = this.stamps.get(key);
    if (previous?.revision === source.revision) return previous.time;
    const time = Math.max(Date.now(), (previous?.time ?? 0) + 1);
    this.stamps.set(key, { revision: source.revision, time });
    return time;
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const source = await this.read(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: this.stamp(uri, source), size: Buffer.byteLength(source.text) };
  }
  async readFile(uri: vscode.Uri) {
    const source = await this.read(uri);
    this.loaded.set(uri.toString(), source); this.stamp(uri, source);
    return Buffer.from(source.text);
  }
  async writeFile(uri: vscode.Uri, content: Uint8Array) {
    const key = uri.toString(), source = this.loaded.get(key);
    if (!source) throw vscode.FileSystemError.Unavailable('Read the task source before saving it.');
    const text = Buffer.from(content).toString('utf8'), previous = this.pending.get(key);
    const attempt = previous?.text === text && previous.revision === source.revision ? previous : { id: randomUUID(), text, revision: source.revision };
    this.pending.set(key, attempt);
    const location = taskLocation(uri);
    try {
      const result = await (await this.runtime()).request<TaskSourceSave>(`/tasks/${encodeURIComponent(location.taskId!)}/source`, {
        id: attempt.id, file: location.file, round: source.round, revision: source.revision, text,
      });
      this.loaded.set(key, result.source); this.stamp(uri, result.source); this.pending.delete(key);
      this.saved(location, result.state);
      this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (error) { throw vscode.FileSystemError.Unavailable(error instanceof Error ? error.message : String(error)); }
  }
  private async poll() {
    if (this.polling || !this.loaded.size) return;
    this.polling = true;
    try {
      await Promise.all([...this.loaded.keys()].map(async key => {
        const uri = vscode.Uri.parse(key);
        try {
          const next = await this.read(uri), previous = this.stamps.get(key)?.revision;
          this.stamp(uri, next);
          if (previous && previous !== next.revision) this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        } catch { /* A closed or unavailable task reports the error when opened. */ }
      }));
    } finally { this.polling = false; }
  }
  watch() { return new vscode.Disposable(() => {}); }
  forget(uri: vscode.Uri) { const key = uri.toString(); this.loaded.delete(key); this.pending.delete(key); this.stamps.delete(key); }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): never { throw vscode.FileSystemError.NoPermissions('Create task files through Papilot.'); }
  delete(): never { throw vscode.FileSystemError.NoPermissions('Delete task files through Papilot.'); }
  rename(): never { throw vscode.FileSystemError.NoPermissions('Rename task files through Papilot.'); }
  dispose() { clearInterval(this.timer); this.changed.dispose(); this.loaded.clear(); }
}
