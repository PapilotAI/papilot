import type { GitGraphCommit } from '../shared.ts';

export interface GraphEdge { from: number; to: number; parent: boolean }
export interface GraphRow { commit: GitGraphCommit; lane: number; incoming: boolean; edges: GraphEdge[] }

// Each lane carries an actual pending parent hash. Joining an occupied lane
// draws a merge; a second parent opens a lane instead of inventing a hierarchy.
export function graphRows(commits: GitGraphCommit[]): { rows: GraphRow[]; lanes: number } {
  let active: string[] = [], lanes = 1;
  const rows = commits.map(commit => {
    const incoming = active.includes(commit.hash);
    if (!incoming) active.push(commit.hash);
    const before = [...active], lane = before.indexOf(commit.hash);
    const after = before.filter(hash => hash !== commit.hash);
    for (const [index, parent] of commit.parents.entries()) {
      if (!after.includes(parent)) after.splice(Math.min(lane + index, after.length), 0, parent);
    }
    const edges: GraphEdge[] = before.flatMap((hash, from) => hash === commit.hash ? [] : [{ from, to: after.indexOf(hash), parent: false }]);
    edges.push(...commit.parents.map(parent => ({ from: lane, to: after.indexOf(parent), parent: true })));
    lanes = Math.max(lanes, before.length, after.length);
    active = after;
    return { commit, lane, incoming, edges };
  });
  return { rows, lanes };
}
