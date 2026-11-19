import { inspectTypeless } from '../desktop/typeless.ts';

// Run on the editor's computer, not a remote Papilot server. This reports
// installation and shortcuts only; it does not start a microphone or send keys.
console.log(JSON.stringify(await inspectTypeless(), null, 2));
