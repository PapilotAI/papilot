// osx-sign scans every unpacked server dependency concurrently, exhausting file
// descriptors on macOS runners. Limit binary probes until upstream bounds them:
// https://github.com/electron/osx-sign/pull/286
// Preload before electron-builder imports the signer; affect only its copy of
// isbinaryfile, never the packaged app or other file operations.
const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const signerRequire = createRequire(appBuilderRequire.resolve('@electron/osx-sign'));
const binary = signerRequire('isbinaryfile');
const probe = binary.isBinaryFile;
const waiting = [];
let active = 0;
binary.isBinaryFile = async (...args) => {
  if (active >= 32) await new Promise(resolve => waiting.push(resolve));
  else active++;
  try { return await probe(...args); }
  finally {
    if (waiting.length) waiting.shift()();
    else active--;
  }
};
