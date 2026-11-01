import type { AgentModel } from '../shared.ts';

// Without an effort of its own choosing, a task reasons at high effort where
// its model offers it: a catalog's default can be as low as "low", too little
// for revising a paper. An explicit "Model default" ('') is kept.
const DEFAULT_EFFORT = 'high';
export function taskEffort(choice: string | null, model?: AgentModel) {
  if (choice === '') return '';
  if (choice && (!model || model.efforts.includes(choice))) return choice;
  return model?.efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : '';
}
