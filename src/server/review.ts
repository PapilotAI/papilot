import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ENGINE } from './paths.ts';

export interface ReviewClient { url: string; token: string; get<T = any>(route: string): Promise<T>; post<T = any>(route: string, body?: unknown): Promise<T> }
let modulePromise: Promise<{ connect: (root: string) => Promise<ReviewClient> }> | null = null;
export function reviewClient(root: string): Promise<ReviewClient> {
  modulePromise ??= import(pathToFileURL(path.join(ENGINE, 'src/client.ts')).href);
  return modulePromise!.then(module => module.connect(root));
}
export const taskRoute = (name: string) => `/api/tasks/${encodeURIComponent(name)}`;

export function confirmedReviewResponse(status: number, value: unknown, task: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (status === 400 || status === 409) return typeof result.error === 'string';
  return status >= 200 && status < 300 && result.task === task && typeof result.csrf === 'string' && typeof result.closed === 'boolean'
    && result.decisions !== null && typeof result.decisions === 'object' && !Array.isArray(result.decisions);
}

export function allowedReviewRoute(route: string, method: string): boolean {
  if (route.includes('..') || route.includes('\\')) return false;
  if (method === 'GET') return route === '/' || /^\/(assets|fonts)\/[\w./-]+$/.test(route) || /^\/files\/[a-z0-9-]+\/\d+\/[\w.-]+\.(svg|png)$/.test(route) || /^\/api\/tasks(?:\/[a-z0-9-]+(?:\/(?:state|rounds\/\d+))?)?$/.test(route);
  return method === 'POST' && /^\/api\/tasks\/[a-z0-9-]+\/(decide|undo|note)$/.test(route);
}
export function rewriteReviewJson(value: any, prefix: string): any {
  if (Array.isArray(value)) return value.map(v => rewriteReviewJson(v, prefix));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'url' && typeof v === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(v) ? prefix + new URL(v).pathname + new URL(v).search : rewriteReviewJson(v, prefix)]));
  return typeof value === 'string' && value.startsWith('/files/') ? prefix + value : value;
}
export function rewriteReviewHtml(html: string, prefix: string): string {
  const script = `<script>(()=>{const prefix=${JSON.stringify(prefix)};if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>b.toString(16).padStart(2,'0')).join('');const original=window.fetch;window.fetch=(input,init)=>{if(typeof input==='string'&&input.startsWith('/api/'))input=prefix+input;return original.call(window,input,init)};})();</script>`;
  return html.replace(/(src|href)="\/(?!\/)/g, `$1="${prefix}/`).replace('<head>', '<head>' + script);
}
