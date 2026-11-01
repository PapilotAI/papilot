import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { backendEnvironment } from '../desktop/runtime.ts';

test('desktop preserves compiler PATH and removes Windows casing duplicates', { skip: process.platform !== 'win32' }, () => {
  const compiler = 'C:\\TeXLive\\bin\\windows';
  const other = 'C:\\custom-bin';
  const inherited = { Path: compiler, PATH: other, KEEP: 'yes' };
  const env = backendEnvironment(process.execPath, process.cwd(), process.cwd(), inherited);
  assert.deepEqual(Object.keys(env).filter(key => key.toLowerCase() === 'path'), ['PATH']);
  assert.ok(env.PATH.split(path.delimiter).includes(compiler));
  assert.ok(env.PATH.split(path.delimiter).includes(other));
  assert.equal((env as NodeJS.ProcessEnv).KEEP, 'yes');
  assert.equal(inherited.Path, compiler);
});

