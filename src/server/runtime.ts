import path from 'node:path';
import { Store } from './store.ts';
import { Workspace } from './workspace.ts';
import { Manuscripts } from './manuscript.ts';
import { Changes } from './changes.ts';
import { moveLegacyStates } from './state.ts';
import { reviewClient } from './review.ts';

/** Shared services for hosts that own Papilot's lifecycle. */
export async function createRuntime(data: string, connectReview = reviewClient) {
  const store = new Store(path.join(data, 'papilot.sqlite'));
  await moveLegacyStates(store.projects().map(project => project.path));
  const workspace = new Workspace(store, undefined, connectReview);
  const manuscripts = new Manuscripts(), changes = new Changes();
  return { store, workspace, manuscripts, changes };
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
