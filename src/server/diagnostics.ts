import path from 'node:path';
import { runNodeScript } from '../../engine/src/core/node-script.ts';
import type { DiagnosticCheck, DiagnosticReport } from '../shared.ts';
import { DATA, PORT, ROOT } from './paths.ts';

type DoctorReport = Pick<DiagnosticReport, 'version' | 'ok' | 'checks'>;

// A failed environment check exits with 1 and still returns a useful report.
// Never surface raw stdout/stderr from a failed diagnostic process.
export function parseDoctorReport(output: string): DoctorReport {
  const report = JSON.parse(output);
  if (typeof report.version !== 'string' || typeof report.ok !== 'boolean' || !Array.isArray(report.checks) || !report.checks.length || !report.checks.every((item: DiagnosticCheck) =>
    item && typeof item.id === 'string' && typeof item.ok === 'boolean' && ['error', 'warn', 'info'].includes(item.severity)
      && typeof item.detail === 'string' && (item.fix === null || typeof item.fix === 'string'))) throw new Error('Invalid diagnostic report.');
  return { version: report.version, ok: report.ok, checks: report.checks };
}

async function runDoctor(repo?: string, port = PORT): Promise<DoctorReport> {
  let output: Buffer;
  try {
    output = await runNodeScript(path.join(ROOT, 'bin/papilot.mjs'), ['doctor', '--json', '--data', DATA, '--port', String(port), ...(repo ? ['--repo', repo] : [])], { cwd: ROOT, timeout: 45000 });
  } catch (error) {
    const failed = error as { code?: number; stdout?: Buffer };
    if (failed.code !== 1 || !failed.stdout) throw new Error('Could not complete the environment checks. Please try again.');
    output = failed.stdout;
  }
  try { return parseDoctorReport(output.toString()); }
  catch { throw new Error('Could not complete the environment checks. Please try again.'); }
}

// Tabs checking the same paper share one probe, without caching old results.
export class Diagnostics {
  private pending = new Map<string, Promise<DiagnosticReport>>();
  constructor(private probe: (repo?: string, port?: number) => Promise<DoctorReport> = runDoctor) {}
  check(repo?: string, port = PORT): Promise<DiagnosticReport> {
    const key = JSON.stringify([repo, port]);
    const current = this.pending.get(key);
    if (current) return current;
    const run = Promise.resolve().then(() => this.probe(repo, port)).then(report => ({
      ...report, checkedAt: Date.now(), platform: process.platform, arch: process.arch, node: process.versions.node,
    })).finally(() => { this.pending.delete(key); });
    this.pending.set(key, run);
    return run;
  }
}
