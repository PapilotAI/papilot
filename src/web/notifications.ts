import { useSyncExternalStore } from 'react';
import type { Snapshot, Task } from '../shared.ts';
import { browserStorage } from './storage.ts';
import { t, tn } from './i18n.ts';

// Browser notifications tell the author when a task needs them while Papilot is
// in the background: an agent asks a question or for approval, a review is
// ready, or a task stops on an error. They are off until the author turns
// them on, and the browser's permission is asked for at that moment.
const key = 'papilot:notifications';
export type NotificationState = { on: boolean; permission: NotificationPermission | 'unsupported' | 'insecure' };
function read(): NotificationState {
  const on = browserStorage.getItem(key) === 'on';
  if (typeof window === 'undefined' || !('Notification' in window)) return { on, permission: 'unsupported' };
  // Browsers only offer notifications on HTTPS and localhost.
  if (!window.isSecureContext) return { on, permission: 'insecure' };
  return { on, permission: Notification.permission };
}
let state = read();
const listeners = new Set<() => void>();
function refresh() {
  const next = read();
  if (next.on !== state.on || next.permission !== state.permission) { state = next; listeners.forEach(listener => listener()); }
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) refresh(); });
  // The permission can change in the browser's site settings while the page is open.
  window.addEventListener('focus', refresh);
}
export const notificationState = () => state;
export const notifying = () => state.on && state.permission === 'granted';
export function subscribeNotifications(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useNotifications() { return useSyncExternalStore(subscribeNotifications, notificationState); }

export async function setNotifications(on: boolean) {
  if (on && state.permission === 'default') await Notification.requestPermission();
  if (on) browserStorage.setItem(key, 'on'); else browserStorage.removeItem(key);
  refresh();
}

export interface TaskAlert { taskId: string; title: string; body: string }
const agentNames: Record<string, string> = { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' };
// What changed since the last snapshot that the author should hear about.
// Each task gives at most one alert per change of state.
export function taskAlerts(previous: Snapshot, next: Snapshot): TaskAlert[] {
  const alerts: TaskAlert[] = [];
  for (const task of next.tasks) {
    const before = previous.tasks.find(t => t.id === task.id);
    if (!before) continue;
    const agent = agentNames[task.agent || 'codex'] || 'Codex';
    const asked = next.requests.filter(r => r.taskId === task.id && !previous.requests.some(p => p.id === r.id));
    if (asked.length) {
      const question = asked.some(r => r.method.endsWith('requestUserInput'));
      alerts.push({ taskId: task.id, title: question ? t('{agent} needs your input', { agent }) : t('{agent} is waiting for your approval', { agent }), body: task.title });
    } else if (before.status === 'building' && task.status === 'reviewing') {
      const pending = task.review?.counts?.pending || 0;
      alerts.push({ taskId: task.id, title: pending ? tn(pending, 'Review ready · {n} change to decide', 'Review ready · {n} changes to decide') : t('{agent} finished', { agent }), body: task.title });
    } else if (task.status !== before.status && (task.status === 'failed' || task.status === 'uncertain' || (task.status === 'interrupted' && task.error))) {
      alerts.push({ taskId: task.id, title: t('A task needs attention'), body: firstLine(task, task.title) });
    }
  }
  return alerts;
}
function firstLine(task: Task, title: string) {
  const error = task.error?.split('\n').find(line => line.trim())?.trim();
  return error ? `${title}\n${error.slice(0, 160)}` : title;
}

// One notification per task: a newer one replaces the last and alerts again.
export function notify(alert: TaskAlert, open: (taskId: string) => void) {
  if (!notifying()) return;
  try {
    const notification = new Notification(alert.title, { body: alert.body, tag: 'papilot:' + alert.taskId, renotify: true, icon: '/favicon.png' } as NotificationOptions);
    notification.onclick = () => { window.focus(); open(alert.taskId); notification.close(); };
  } catch { /* Some browsers only allow notifications from a service worker. */ }
}

export function testNotification() {
  try { new Notification(t('Notifications are on'), { body: t('Papilot will tell you here when a task needs you.'), tag: 'papilot:test', icon: '/favicon.png' }); return true; }
  catch { return false; }
}
