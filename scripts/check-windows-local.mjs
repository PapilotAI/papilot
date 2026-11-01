import { _electron as electron } from '../vendor/latex-review/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const packaged=process.argv[2];
const env={...process.env,PAPILOT_DESKTOP_DATA:process.env.PAPILOT_DESKTOP_DATA || fs.mkdtempSync(path.join(os.tmpdir(),'papilot-win-')), PAPILOT_DESKTOP_NODE:process.execPath,PAPILOT_UPDATE_PROBE:'1'};
delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:packaged||path.resolve('node_modules/electron/dist/electron.exe'),args:packaged?[]:['.desktop/app'],env,timeout:60000});
try {
 const page=await app.firstWindow({timeout:60000});
 await page.waitForURL('http://127.0.0.1:*/',{timeout:60000});
 const origin=new URL(page.url()).origin;
 const health=await (await fetch(origin+'/api/health')).json();assert.equal(health.name,'Papilot');
 const state=await (await fetch(origin+'/api/state')).json();
 console.log('HEALTH',health.name,health.version,'PROJECTS',state.projects.length);
 assert.equal(state.projects.length,1);
 const manuscript=await (await fetch(origin+'/api/projects/'+state.projects[0].id+'/manuscript')).json();
 assert.equal(manuscript.build.status,'ready');
 const pdf=await fetch(origin+'/api/projects/'+state.projects[0].id+'/manuscript.pdf?key='+manuscript.build.key);
 assert.equal(pdf.status,200);
 assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 await page.waitForTimeout(2500);
 if(process.env.PAPILOT_SCREENSHOT) await page.screenshot({path:path.resolve(process.env.PAPILOT_SCREENSHOT)});
 console.log('WINDOW',await page.title(),'SCREENSHOT saved');
} finally {await app.close();}
