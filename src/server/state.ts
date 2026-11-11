import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from './paths.ts';

type Git = typeof import('../../engine/src/core/git.ts');
let loaded: Promise<Git> | undefined;
const git = () => loaded ??= import(pathToFileURL(path.join(ENGINE, 'src/core/git.ts')).href);

/** A paper's state folder in its Git directory, shared with the review engine. */
export async function stateOf(root: string) { return (await git()).stateOf(root); }
export async function stateDir(gitDir: string) { return (await git()).stateDir(gitDir); }
/** Moves each paper's state from the names that Papilot 0.9.4 and earlier
 *  used, before anything reads it: on startup, and when a paper is added. */
export async function moveLegacyStates(roots: string[]) {
  const { stateOf } = await git();
  for (const root of roots) {
    try { stateOf(root); } catch (error) { console.error(`Could not move the review state of ${root}:`, (error as Error).message); }
  }
}
