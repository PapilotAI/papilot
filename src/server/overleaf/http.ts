import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';

// Papilot talks to Overleaf as the author's own browser session would: the
// cookies the author signed in with, the page's CSRF token on every change,
// and the same endpoints the Overleaf editor calls.

export const OVERLEAF = 'https://www.overleaf.com';
// Overleaf accepts uploads up to 50 MB.
export const FILE_LIMIT = 50 * 1024 * 1024;
const PAGE_LIMIT = 8 * 1024 * 1024;

export class SignInError extends Error { constructor(message: string) { super(message); this.name = 'SignInError'; } }
export class AccessError extends Error { constructor(message: string) { super(message); this.name = 'AccessError'; } }
export class ConnectionError extends Error { constructor(message: string) { super(message); this.name = 'ConnectionError'; } }
/** An entity that is no longer on Overleaf, unlike a project Papilot cannot open. */
export class NotFoundError extends Error { constructor(message: string) { super(message); this.name = 'NotFoundError'; } }

/** A server's origin from what the author typed: Overleaf's own site, or a
 *  self-hosted one, which may run on plain HTTP inside a lab. */
export function serverOrigin(value: unknown) {
  if (value === undefined || value === null || value === '') return OVERLEAF;
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Enter the address of the Overleaf server.');
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim()); } catch { throw new Error('Enter the address of the Overleaf server.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter the address of the Overleaf server.');
  if (url.hostname === 'overleaf.com' || url.hostname === 'www.overleaf.com') return OVERLEAF;
  return url.origin;
}
export const sameSite = (origin: string, other: string) => {
  const a = new URL(origin), b = new URL(other);
  if (a.protocol !== b.protocol && !(a.protocol === 'https:' && b.protocol === 'wss:') && !(a.protocol === 'http:' && b.protocol === 'ws:')) return false;
  const host = a.hostname.replace(/^www\./, '');
  return b.hostname === a.hostname || b.hostname === host || b.hostname.endsWith('.' + host);
};

export type Cookies = Record<string, string>;
export const cookieHeader = (cookies: Cookies) => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
/** Cookies from a Cookie header the author pasted, or from the sign-in window. */
export function parseCookies(header: string): Cookies {
  const cookies: Cookies = {};
  for (const part of header.split(/;\s*/)) {
    const at = part.indexOf('=');
    if (at > 0) { const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim(); if (/^[!#$%&'*+\-.^_`|~\w]+$/.test(name) && !/[\s;,]/.test(value)) cookies[name] = value; }
  }
  return cookies;
}
function absorb(cookies: Cookies, headers: string[] | undefined) {
  let changed = false;
  for (const line of headers || []) {
    const [pair, ...attributes] = line.split(';'), at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
    const expired = attributes.some(attribute => { const [key, raw] = attribute.split('='); const lower = key.trim().toLowerCase(); return (lower === 'max-age' && Number(raw) <= 0) || (lower === 'expires' && Date.parse(raw) < Date.now()); });
    if (expired) { if (name in cookies) { delete cookies[name]; changed = true; } }
    else if (cookies[name] !== value) { cookies[name] = value; changed = true; }
  }
  return changed;
}

/** The ol-* values Overleaf puts in a page's meta tags. */
export function pageMeta(html: string) {
  const values: Record<string, unknown> = {}, nodes: DefaultTreeAdapterMap['node'][] = [parse(html)];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('tagName' in node && node.tagName === 'meta') {
      const attr = (name: string) => node.attrs.find(item => item.name === name)?.value;
      const name = attr('name');
      if (name?.startsWith('ol-')) {
        const content = attr('content'), type = attr('data-type');
        try { values[name.slice(3)] = type === 'json' ? JSON.parse(content ?? 'null') : type === 'boolean' ? content !== undefined : content; } catch { /* An unreadable value is left out. */ }
      }
    }
    if ('childNodes' in node) nodes.push(...node.childNodes);
  }
  return values;
}

type Body = string | Buffer | { json: unknown } | { form: Record<string, string>; file?: { field: string; name: string; data: Buffer } };
export interface Response { status: number; headers: http.IncomingHttpHeaders; data: Buffer; location?: string }

export class OverleafHttp {
  private csrf: string | null = null;
  // Requests of a connection end with it, so a half-open one never holds up the sync.
  constructor(readonly origin: string, readonly cookies: Cookies, private saved: () => void = () => {}, private signal?: AbortSignal) {}
  /** The agent for a request: the host's HTTPS proxy, if it has one. */
  agent(url: URL) {
    const proxy = url.protocol === 'https:' || url.protocol === 'wss:' ? getProxyForUrl(url.href.replace(/^wss:/, 'https:')) : '';
    return proxy && /^https?:\/\//i.test(proxy) ? new HttpsProxyAgent(proxy) : undefined;
  }
  absorb(headers: string[] | undefined) { if (absorb(this.cookies, headers)) this.saved(); }
  async request(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: Body; accept?: string; limit?: number; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    if (!sameSite(this.origin, url.href)) throw new Error('Overleaf requests stay on the Overleaf server.');
    const headers: Record<string, string> = { 'User-Agent': 'Papilot', Accept: options.accept ?? 'application/json', ...options.headers };
    const cookie = cookieHeader(this.cookies);
    if (cookie) headers.Cookie = cookie;
    let payload: Buffer | undefined;
    const body = options.body;
    if (typeof body === 'string' || Buffer.isBuffer(body)) payload = Buffer.from(body);
    else if (body && 'json' in body) { payload = Buffer.from(JSON.stringify(body.json)); headers['Content-Type'] = 'application/json'; }
    else if (body && 'form' in body) {
      const boundary = '----Papilot' + randomUUID().replace(/-/g, ''), parts: Buffer[] = [];
      for (const [name, value] of Object.entries(body.form)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      if (body.file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${body.file.field}"; filename="${encodeURIComponent(body.file.name)}"\r\nContent-Type: application/octet-stream\r\n\r\n`), body.file.data, Buffer.from('\r\n'));
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      payload = Buffer.concat(parts); headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
    }
    if (payload) headers['Content-Length'] = String(payload.length);
    const limit = options.limit ?? PAGE_LIMIT, agent = this.agent(url), signal = options.signal ?? this.signal;
    if (signal?.aborted) throw new ConnectionError('The connection to Overleaf closed.');
    try {
      return await new Promise<Response>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).request(url, { method: options.method ?? 'GET', headers, agent, signal }, response => {
          this.absorb(response.headers['set-cookie']);
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', (chunk: Buffer) => {
            if ((size += chunk.length) > limit) { response.destroy(); reject(new Error('Overleaf sent more data than expected.')); return; }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, data: Buffer.concat(chunks), location: response.headers.location }));
          response.on('error', reject);
          response.on('aborted', () => reject(new ConnectionError('Could not reach Overleaf. Papilot keeps trying.')));
        });
        request.on('error', reject);
        // A request that goes silent for a minute is a dead connection.
        request.setTimeout(60_000, () => request.destroy(new ConnectionError('Overleaf stopped responding. Papilot reconnects.')));
        request.end(payload);
      });
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new ConnectionError('The connection to Overleaf closed.');
      throw error instanceof Error && error.message === 'Overleaf sent more data than expected.' ? error : new ConnectionError('Could not reach Overleaf. Papilot keeps trying.');
    } finally { agent?.destroy(); }
  }
  /** A response that is not a redirect to the sign-in page or a refusal. */
  private checked(response: Response, entity = false) {
    if (response.status >= 300 && response.status < 400) {
      const target = new URL(response.location || '/', this.origin);
      if (/\/login\/?$/.test(target.pathname)) throw new SignInError('Sign in to Overleaf again.');
      if (/\/restricted\/?$/.test(target.pathname)) throw new AccessError('This Overleaf account cannot open the project.');
      throw new ConnectionError('Overleaf answered unexpectedly. Papilot keeps trying.');
    }
    if (response.status === 401) throw new SignInError('Sign in to Overleaf again.');
    if (response.status === 404 && entity) throw new NotFoundError('This file is no longer on Overleaf.');
    if (response.status === 403 || response.status === 404) throw new AccessError('This Overleaf account cannot open the project.');
    if (response.status === 429) throw new ConnectionError('Overleaf asked Papilot to slow down. It tries again shortly.');
    // An error about one file is that file's; a gateway error is the connection's.
    if (entity && response.status === 500) throw Object.assign(new Error('Overleaf refused the change.'), { statusCode: 500 });
    if (response.status >= 500 || response.status === 0) throw new ConnectionError('Could not reach Overleaf. Papilot keeps trying.');
    return response;
  }
  async page(path: string) {
    const response = this.checked(await this.request(path, { accept: 'text/html' }));
    if (response.status !== 200) throw new AccessError('This Overleaf account cannot open the project.');
    const meta = pageMeta(response.data.toString('utf8'));
    if (typeof meta.csrfToken === 'string') this.csrf = meta.csrfToken;
    return meta;
  }
  /** The signed-in account, from the project list page. */
  async account() {
    const meta = await this.page('/project');
    const userId = typeof meta.user_id === 'string' ? meta.user_id : (meta.user as { id?: string } | undefined)?.id;
    if (!userId) throw new SignInError('Sign in to Overleaf again.');
    return { userId, email: typeof meta.usersEmail === 'string' ? meta.usersEmail : (meta.user as { email?: string } | undefined)?.email || '' };
  }
  private async token() { if (!this.csrf) await this.page('/project'); return this.csrf!; }
  async json<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: Body; limit?: number; entity?: boolean } = {}): Promise<T> {
    const send = async () => this.request(path, { ...options, headers: options.method && options.method !== 'GET' ? { 'X-Csrf-Token': await this.token(), 'X-Requested-With': 'XMLHttpRequest' } : undefined });
    let response = await send();
    // An expired page token: read a fresh one once.
    if (response.status === 403 && options.method && options.method !== 'GET' && /csrf/i.test(response.data.toString('utf8'))) { this.csrf = null; response = await send(); }
    if (response.status === 422 || response.status === 400) {
      let detail = '';
      try { detail = String((JSON.parse(response.data.toString('utf8')) as { error?: string; message?: string }).error || ''); } catch { /* Not JSON. */ }
      throw Object.assign(new Error(detail === 'duplicate_file_name' ? 'A file with this name already exists on Overleaf.' : detail === 'project_has_too_many_files' ? 'The Overleaf project has too many files.' : detail === 'invalid_filename' ? 'Overleaf does not accept this file name.' : 'Overleaf refused the change.'), { code: detail || 'refused', statusCode: 422 });
    }
    this.checked(response, options.entity);
    if (response.status >= 400) throw Object.assign(new Error('Overleaf refused the change.'), { statusCode: response.status });
    const text = response.data.toString('utf8');
    try { return (text ? JSON.parse(text) : {}) as T; } catch { throw Object.assign(new Error('Overleaf refused the change.'), { statusCode: 502 }); }
  }
  async download(path: string) {
    const response = this.checked(await this.request(path, { accept: '*/*', limit: FILE_LIMIT }), true);
    if (response.status !== 200) throw new NotFoundError('This file is no longer on Overleaf.');
    return response.data;
  }
}
