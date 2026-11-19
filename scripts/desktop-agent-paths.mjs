import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
fs.writeFileSync('.desktop/app/agent-paths.mjs', fs.readFileSync('bin/agent-paths.mjs', 'utf8').replace('../engine/src/core/platform.mjs', './platform.mjs'));
fs.copyFileSync('engine/src/core/platform.mjs', '.desktop/app/platform.mjs');
for (const file of ['environment.html', 'environment.css', 'environment-ui.mjs', 'wsl-runtime.mjs']) fs.copyFileSync('desktop/' + file, '.desktop/app/' + file);
if (process.platform === 'darwin') execFileSync('/usr/bin/xcrun', ['clang', '-O2', '-mmacosx-version-min=13.0', '-fobjc-arc', '-framework', 'AppKit', '-framework', 'ApplicationServices', 'desktop/typeless-keyboard.m', '-o', '.desktop/app/typeless-keyboard'], { stdio: 'inherit' });
