import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SshDocument, SshEntry, SshFolder, SshFolderPreview } from '../../shared.ts';
import type { Store } from '../store.ts';
import { hostName, sshAliases } from './config.ts';

type Destination = Omit<SshFolder, 'id'>;
type Listing = { root: string; entries: SshEntry[] };
type Request = { action: 'browse' | 'list' | 'read' | 'save'; resolveRoot?: boolean; page?: number; path?: string; revision?: string; text?: string };
const helper = readFileSync(new URL('./files.py', import.meta.url), 'utf8');
// Only the bundled program crosses the remote login shell. File paths and
// manuscript text travel as JSON on stdin, including spaces and quotes.
const command = "python3 -I -c '" + helper.replaceAll("'", "'\\''") + "'";

function destination(body: Partial<SshFolder>): Destination {
  const { host, user, port, identity, root } = body;
  if (typeof host !== 'string' || host.length > 255 || !hostName.test(host)
    || (user !== undefined && (typeof user !== 'string' || !/^[\w.][\w.-]*\$?$/.test(user)))
    || (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)))
    throw new Error('Invalid SSH destination.');
  if (identity !== undefined && (typeof identity !== 'string' || (!identity.startsWith('~/') && !path.isAbsolute(identity)) || /[\x00-\x1f%]/.test(identity)))
    throw new Error('Enter an absolute path to the SSH identity file.');
  if (typeof root !== 'string' || !(root === '~' || root.startsWith('~/') || root.startsWith('/')) || root.includes('\0'))
    throw new Error('Enter an absolute remote folder path or a path starting with ~/.');
  return { host, user, port, identity, root };
}

const badReply = () => new Error('Unexpected SSH response. Check that the remote shell can run Python 3.');
const remoteErrors: Record<string, { error: string; status: number }> = {
  conflict: { error: 'The remote file changed. Copy your edits before reloading.', status: 409 },
  'text-limit': { error: 'Choose a UTF-8 text file up to 2 MB.', status: 400 },
  'mixed-endings': { error: 'This file uses mixed line endings. Normalize them before editing.', status: 400 },
  'hard-link': { error: 'Choose a file without hard links.', status: 400 },
};

function response(output: string, action: Request['action']) {
  let result;
  try { result = JSON.parse(output); } catch { throw badReply(); }
  if (!result || typeof result !== 'object') throw badReply();
  if (typeof result.error === 'string') {
    const known = Object.hasOwn(remoteErrors, result.error) ? remoteErrors[result.error] : undefined;
    throw Object.assign(new Error(known?.error ?? result.error), { statusCode: known?.status ?? 400 });
  }
  if (action === 'browse' && (!Number.isSafeInteger(result.page) || !Number.isSafeInteger(result.pages) || result.page < 0 || result.page >= result.pages)) throw badReply();
  if (action === 'list' || action === 'browse') {
    if (typeof result.root !== 'string' || !result.root.startsWith('/') || result.root.includes('\0') ||
      !Array.isArray(result.entries) || !result.entries.every((entry: SshEntry | null) => entry && typeof entry.name === 'string' &&
        entry.name.length && !/[\x00/]/.test(entry.name) && entry.name !== '.' && entry.name !== '..' && typeof entry.folder === 'boolean')) throw badReply();
  } else if (typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision) || (action === 'read' && typeof result.text !== 'string')) throw badReply();
  return result;
}

export function sshRequest<T>(target: Destination, request: Request): Promise<T> {
  const args = ['-T', '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oConnectTimeout=12', '-oClearAllForwardings=yes',
    '-oForwardAgent=no', '-oForwardX11=no', '-oPermitLocalCommand=no', '-oRemoteCommand=none'];
  if (target.user) args.push('-l', target.user);
  if (target.port) args.push('-p', String(target.port));
  if (target.identity) args.push('-i', target.identity.startsWith('~/') ? path.join(os.homedir(), target.identity.slice(2)) : target.identity);
  args.push('--', target.host, command);
  return new Promise((resolve, reject) => {
    const child = execFile('ssh', args, { timeout: 45000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim().slice(-1800) || (error.code === 'ENOENT' ? 'OpenSSH (ssh) was not found.' : 'SSH connection failed or timed out.');
        return reject(new Error(detail));
      }
      try {
        resolve(response(stdout, request.action) as T);
      } catch (failure) { reject(failure); }
    });
    // OpenSSH may reject a connection before a large document finishes piping.
    child.stdin!.on('error', () => {});
    child.stdin!.end(JSON.stringify({ ...request, root: target.root }));
  });
}

export function registerSshRoutes(app: FastifyInstance, store: Store) {
  const key = 'ssh-folders';
  const folders = () => store.preference<SshFolder[]>(key) ?? [];
  app.get('/api/ssh', async () => ({ folders: folders(), aliases: await sshAliases() }));
  app.post<{ Body: Partial<SshFolder> & { canonical?: boolean; page?: number } }>('/api/ssh/browse', { bodyLimit: 16384 }, async req => {
    const target = destination({ ...req.body, root: req.body?.root ?? '/' });
    const page = req.body?.page ?? 0;
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid page number.');
    return sshRequest<SshFolderPreview>(target, { action: 'browse', page, resolveRoot: req.body?.canonical !== true });
  });
  app.post<{ Body: Partial<SshFolder> }>('/api/ssh/connect', { bodyLimit: 16384 }, async req => {
    const target = destination(req.body ?? {});
    // The picker already resolved this path. A symlink substituted since
    // selection must not redirect the bookmark to another directory.
    const { root, entries } = await sshRequest<Listing>(target, { action: 'list' });
    const all = folders();
    let folder = all.find(f => f.root === root && f.host === target.host && f.user === target.user && f.port === target.port && f.identity === target.identity);
    if (!folder) {
      folder = { ...target, root, id: randomUUID() };
      store.savePreference(key, [...all, folder]);
    }
    return { folder, entries };
  });
  app.post<{ Params: { id: string } }>('/api/ssh/:id/forget', async req => {
    store.savePreference(key, folders().filter(f => f.id !== req.params.id));
    return { ok: true };
  });
  for (const action of ['list', 'read', 'save'] as const) {
    app.post<{ Params: { id: string }; Body: { path?: string; revision?: string; text?: string } }>('/api/ssh/:id/' + action,
      { bodyLimit: action === 'save' ? 12_100_000 : 16384 }, async req => {
        const folder = folders().find(f => f.id === req.params.id);
        if (!folder) throw new Error('SSH connection not found.');
        const { path: relative, revision, text } = req.body ?? {};
        if (typeof relative !== 'string' || relative.includes('\0') || (relative ? relative.split('/').some(p => !p || p === '.' || p === '..') : action !== 'list'))
          throw new Error('Invalid file path.');
        if (action === 'save') {
          if (typeof text !== 'string' || Buffer.byteLength(text) > 2_000_000 || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision))
            throw new Error('Invalid source edit.');
          return sshRequest<Pick<SshDocument, 'revision'>>(folder, { action, path: relative, text, revision });
        }
        return sshRequest<Listing | SshDocument>(folder, { action, path: relative });
      });
  }
}
