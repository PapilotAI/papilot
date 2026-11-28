import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { Manuscripts } from './manuscript.ts';
import { Changes } from './changes.ts';
import { moveLegacyStates } from './state.ts';
import { reviewClient } from './review.ts';
import { realPath } from './real-path.ts';

// Give detached agents time to close their tools and finish process cleanup.
export const RUNTIME_SHUTDOWN_TIMEOUT_MS = 11_000;

/** Shared services for hosts that own Papilot's lifecycle. */
export async function createRuntime(data: string, connectReview = reviewClient) {
  const store = new Store(path.join(data, 'papilot.sqlite'));
  await moveLegacyStates(store.projects().map(project => project.path));
  const workspace = new Workspace(store, undefined, connectReview);
  const manuscripts = new Manuscripts(), changes = new Changes();
  return { store, workspace, manuscripts, changes };
}

/** Registers a dedicated paper folder on startup when PAPILOT_SINGLE_PAPER is configured. */
export async function ensureSinglePaper(workspace: Workspace, paperPath: string | undefined, paperName?: string) {
  const target = paperPath?.trim();
  if (!target) return null;
  const expanded = target.startsWith('~/') && process.env.HOME ? path.join(process.env.HOME, target.slice(2)) : target;
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Single-paper directory does not exist: ${resolved}`);
  }
  const existing = workspace.projectByPath(realPath(resolved));
  if (existing) return existing;
  return workspace.addProject(resolved, paperName?.trim() || undefined);
}

export function resumeTasks(store: Store, workspace: Workspace) {
  // Recompute cached feedback counts, including decisions from before this restart.
  for (const task of store.tasks()) {
    // A task saved but not yet prepared continues; a failure shows on the task.
    if (task.status === 'preparing') void workspace.prepareTask(task.id);
    else if (task.pendingBuild || (task.review?.job?.id && (task.status === 'building' || (task.status === 'failed' && task.error === 'fetch failed')))) {
      void workspace.resumeBuild(task.id);
    } else if (task.status === 'building') {
      store.updateTask(task.id, { status: 'interrupted', error: 'The server restarted during the PDF build. Check the review and rebuild it if needed.' });
      void workspace.refresh(task.id);
    } else if (task.review?.round && task.status !== 'deleting') void workspace.refresh(task.id);
  }
}
