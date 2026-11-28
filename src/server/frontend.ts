import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';

/** Path prefixes that never fall back to the SPA index.html shell. */
export const NON_SPA_ROUTE = /^\/(api|review|assets|invite|sign-in)(\/|$)/;

/** Review viewer static asset pattern shared with src/server/review.ts `allowedReviewRoute`. */
export const REVIEW_STATIC_ASSET = /^(assets|fonts)(?:\/[A-Za-z0-9_-][\w.-]*)+$/;

const FRONTEND_STATIC_ASSET = /^\/assets(?:\/[A-Za-z0-9_-][\w.-]*)+$/;
const UNSAFE_PATH = /[?#%\x00-\x1f\x7f\\]|\/\/|(?:\.\.)|(?:^|\/)\./;

export interface ReviewFrontendRoute {
  project: string;
  kind: 'page' | 'asset';
  asset?: string;
}

/** Classifies a `/review/<project>/…` path as the review viewer shell or static
 *  asset, or returns null when it belongs to the project's review API/files or
 *  contains unsafe path segments. Note: `kind === 'page'` requires HTML prefix
 *  rewriting via `rewriteReviewHtml` rather than serving the raw file as-is. */
export function parseReviewFrontendPath(pathname: string): ReviewFrontendRoute | null {
  if (!pathname.startsWith('/') || UNSAFE_PATH.test(pathname)) return null;
  const match = /^\/review\/([^/]+)\/(.*)$/.exec(pathname);
  if (!match) return null;
  const [, project, rest] = match;
  if (!/^[a-z0-9-]+$/.test(project)) return null;
  if (rest === '') return { project, kind: 'page' };
  if (!REVIEW_STATIC_ASSET.test(rest)) return null;
  return { project, kind: 'asset', asset: rest };
}

/** Whether a normalized request path is served by the built frontend/viewer
 *  rather than the backend API or project file handlers. Useful for external
 *  reverse proxies that serve static bundles directly. */
export function isFrontendPath(pathname: string): boolean {
  if (!pathname.startsWith('/') || UNSAFE_PATH.test(pathname)) return false;
  if (parseReviewFrontendPath(pathname)) return true;
  if (FRONTEND_STATIC_ASSET.test(pathname)) return true;
  if (NON_SPA_ROUTE.test(pathname)) return false;
  return true;
}

export async function registerFrontend(app: FastifyInstance, root: string) {
  // Resolve assets at request time, so a frontend build can be deployed without
  // restarting the server or interrupting active Codex turns.
  await app.register(staticFiles, { root, prefix: '/', wildcard: true, cacheControl: false, dotfiles: 'deny' });
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (NON_SPA_ROUTE.test(pathname)) return reply.code(404).send({ error: 'Not found' });
    return reply.type('text/html').send(fs.readFileSync(path.join(root, 'index.html')));
  });
}
