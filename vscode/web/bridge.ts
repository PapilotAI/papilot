import { useEffect, useState } from 'react';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const host = acquireVsCodeApi();
function theme() {
  document.documentElement.dataset.theme = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast') ? 'dark' : 'light';
}
theme();
new MutationObserver(theme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
let sequence = 0;
export class HostResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const listeners = new Set<(state: any) => void>();
let current: any;
window.addEventListener('message', event => {
  // VS Code supplies this channel; no iframe or arbitrary Window is a peer.
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'state') { current = message; for (const listener of listeners) listener(message); }
  if (typeof message.id !== 'number') return;
  const request = pending.get(message.id); pending.delete(message.id);
  if (message.error) request?.reject(typeof message.status === 'number' ? new HostResponseError(message.error, message.status) : new Error(message.error));
  else request?.resolve(message.value);
});
export function call<T = any>(type: string, values: Record<string, unknown> = {}): Promise<T> {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); host.postMessage({ ...values, type, id }); });
}
export async function api<T = any>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const file = body instanceof File ? { name: body.name, data: btoa(Array.from(new Uint8Array(await body.arrayBuffer()), byte => String.fromCharCode(byte)).join('')) } : undefined;
  const result = await call<T>('api', { route: '/api' + route, ...(file ? { file } : { body }) });
  signal?.throwIfAborted(); return result;
}
export function useHost<T = any>(): T | undefined {
  const [state, setState] = useState<T | undefined>(current);
  useEffect(() => { listeners.add(setState); return () => { listeners.delete(setState); }; }, []);
  return state;
}
export const command = (command: string, values: Record<string, unknown> = {}) => call('command', { command, taskId: current?.task?.id, ...values });
export const resource = (route: string) => call<string>('resource', { route, taskId: current?.task?.id });
export const ready = () => call('ready');
// The PDF selection layer fetches word coordinates by URL. Other assets use
// VS Code resource URIs and continue through the browser's normal fetch.
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (typeof input === 'string' && input.startsWith('/review/')) {
    const value = await call('api', { route: input });
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  }
  if (typeof input === 'string' && input.startsWith('/api/')) {
    const value = await api(input.slice(4), init?.body ? JSON.parse(String(init.body)) : undefined, init?.signal || undefined);
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
