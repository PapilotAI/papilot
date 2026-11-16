import { createRuntime } from './runtime.ts';
import { PUBLIC_ORIGIN } from './paths.ts';

const runtime = await createRuntime({ shutdown });
const { workspace, manuscripts, changes, updates } = runtime;
console.log(`Papilot is running at ${runtime.url}${PUBLIC_ORIGIN ? `\nRemote: ${PUBLIC_ORIGIN}` : ''}`);
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  void runtime.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
if (process.env.PAPILOT_DESKTOP === '1' && process.send) {
  process.on('disconnect', shutdown);
  process.on('message', message => {
    const value = message as { type?: string; id?: string } | null;
    if (value?.type === 'papilot:shutdown') shutdown();
    if (value?.type === 'papilot:can-switch' && typeof value.id === 'string') process.send?.({ type: value.type, id: value.id,
      busy: workspace.busyForUpdate || manuscripts.busyForUpdate || changes.busyForUpdate || ['installing', 'waiting', 'restarting'].includes(updates.snapshot().phase) });
  });
  process.send({ type: 'papilot:ready', url: runtime.url });
}
