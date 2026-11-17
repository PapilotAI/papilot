import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import type { PaperImports } from './imports.ts';

export function registerImportUpload(app: FastifyInstance, imports: PaperImports) {
  app.register(async uploads => {
    // File contents stream to disk; parser defaults must not impose a project cap.
    await uploads.register(multipart, { preservePath: true, limits: { fileSize: Infinity, files: Infinity, parts: Infinity, fields: 0 } });
    uploads.post<{ Querystring: { name?: string; archive?: string } }>('/api/imports/upload', async (request, reply) => {
      const controller = new AbortController();
      const aborted = () => controller.abort();
      const closed = () => { if (!reply.raw.writableFinished) aborted(); };
      request.raw.on('aborted', aborted);
      reply.raw.on('close', closed);
      try { return await imports.upload(request.files(), request.query.name, request.query.archive === 'true', controller.signal); }
      finally { request.raw.off('aborted', aborted); reply.raw.off('close', closed); }
    });
  });
}
