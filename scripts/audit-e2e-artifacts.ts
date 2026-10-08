import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const forbidden = ['CF_AI_ACCESS_URL', 'CF_AIG_TOKEN', 'OPENCODE_API_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY', 'MISE_AGE_KEY']
  .map((name) => process.env[name]).filter((value): value is string => !!value && value.length >= 8);
if (process.env.CF_AI_ACCESS_URL) {
  try { forbidden.push(new URL(process.env.CF_AI_ACCESS_URL).host); } catch { /* Invalid config is checked by the runner. */ }
}
const execFileAsync = promisify(execFile);
let scanned = 0;
let leaks = 0;
async function scan(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Artifact symlink is not supported.');
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!entry.isFile()) continue;
    const content = entry.name.endsWith('.zip')
      ? (await execFileAsync('unzip', ['-p', path], { env: { PATH: process.env.PATH }, timeout: 10_000, maxBuffer: 128 * 1024 * 1024 })).stdout
      : (await readFile(path)).toString();
    scanned++;
    if (forbidden.some((value) => content.includes(value)) || /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/.test(content)) leaks++;
  }
}
try {
  await scan('.e2e');
  console.log(JSON.stringify({ status: leaks ? 'failed' : 'passed', scanned, leaks }));
  process.exitCode = leaks ? 1 : 0;
} catch {
  console.error(JSON.stringify({ status: 'failed', code: 'ARTIFACT_AUDIT_FAILED', message: 'Could not inspect every local artifact; no artifact content is logged.' }));
  process.exitCode = 1;
}
