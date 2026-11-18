import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OverleafService } from './service.ts';

// The app's view of Overleaf sync. A request that needs a sign-in answers
// 401 with the server to sign in to, so the dialog can offer it in place.
// Browser sessions are those of the computer Papilot runs on, so only a
// browser on that computer is offered them, and sees any Keychain prompt.
export function registerOverleafRoutes(app: FastifyInstance, overleaf: OverleafService, project: () => object, local: (request: FastifyRequest) => boolean) {
  const answer = async <T>(reply: FastifyReply, work: () => Promise<T> | T) => {
    try { return await work(); }
    catch (error) {
      const failure = error as Error & { statusCode?: number; signIn?: string };
      return reply.code(failure.signIn ? 401 : failure.statusCode && failure.statusCode < 500 ? failure.statusCode : 400).send({ error: failure.message, ...(failure.signIn ? { signIn: failure.signIn } : {}) });
    }
  };
  const body = (value: unknown) => (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  app.get('/api/overleaf', () => overleaf.state());
  app.post('/api/overleaf/sign-in', (request, reply) => answer(reply, () => {
    const { origin, cookies, browser, fresh } = body(request.body);
    if (browser === undefined) return overleaf.signIn(origin, cookies, fresh);
    if (!local(request)) throw Object.assign(new Error('Sign in from a browser on the computer Papilot runs on.'), { statusCode: 403 });
    // Closing the dialog cancels a Keychain prompt still waiting.
    const stop = new AbortController(), closed = () => { if (!reply.raw.writableFinished) stop.abort(); };
    reply.raw.on('close', closed);
    return overleaf.signInWithBrowser(origin, browser, stop.signal).finally(() => reply.raw.off('close', closed));
  }));
  // A POST, so only Papilot's own pages, holding its token, make it copy cookie databases.
  app.post('/api/overleaf/browsers', (request, reply) => answer(reply, async () => ({ sessions: local(request) ? await overleaf.browsers(body(request.body).origin) : [] })));
  app.post('/api/overleaf/sign-out', (request, reply) => answer(reply, () => overleaf.signOut(body(request.body).origin)));
  app.get<{ Querystring: { origin?: string } }>('/api/overleaf/projects', (request, reply) => answer(reply, async () => ({ projects: await overleaf.projects(request.query.origin) })));
  app.post<{ Params: { id: string } }>('/api/projects/:id/overleaf/compare', project(), (request, reply) => answer(reply, () => overleaf.compare(request.params.id, body(request.body).url, body(request.body).replace === true)));
  app.post<{ Params: { id: string } }>('/api/projects/:id/overleaf/link', project(), (request, reply) => answer(reply, () => overleaf.link(request.params.id, body(request.body).url, body(request.body).choice, body(request.body).replace === true)));
  app.post<{ Params: { id: string } }>('/api/projects/:id/overleaf/unlink', project(), request => overleaf.unlink(request.params.id));
  app.post<{ Params: { id: string } }>('/api/projects/:id/overleaf/retry', project(), request => overleaf.retry(request.params.id));
  app.post<{ Params: { id: string; conflict: string } }>('/api/projects/:id/overleaf/conflicts/:conflict/use-mine', project(), (request, reply) => answer(reply, () => overleaf.useMine(request.params.id, request.params.conflict)));
  app.post<{ Params: { id: string; conflict: string } }>('/api/projects/:id/overleaf/conflicts/:conflict/dismiss', project(), (request, reply) => answer(reply, () => overleaf.dismiss(request.params.id, request.params.conflict)));
}
