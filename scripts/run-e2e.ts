import { spawn } from 'node:child_process';
import { accessEndpoint, AccessError } from '../tests/support/access-model';

const [mode, ...files] = process.argv.slice(2);
if (mode === '--help') {
  console.log('Usage: bun scripts/run-e2e.ts <run|offline|preflight> [tests/<name>.e2e.ts ...]\nrun: real Access model; offline: deterministic tests only; preflight: vision/schema/tools.\nNo implicit login, credential fallback, retries or cache. Maximum run time: 15 minutes.');
  process.exit(0);
}
if (!['run', 'offline', 'preflight'].includes(mode ?? '') || files.some((file) => !/^tests\/[\w-]+\.e2e\.ts$/.test(file)) || (mode === 'preflight' && files.length)) {
  console.error(JSON.stringify({ status: 'failed', code: 'E2E_ARGUMENT_INVALID', message: 'See --help; optional arguments must be E2E test file paths.' }));
  process.exit(2);
}

// Only runner transport needs the endpoint. Build, synthetic site and Chromium need no global secrets.
const env: Record<string, string> = {};
for (const name of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'TERM', 'NO_COLOR', 'PLAYWRIGHT_BROWSERS_PATH']) {
  if (process.env[name] !== undefined) env[name] = process.env[name]!;
}
env.E2E_TELEMETRY_DISABLED = '1';
if (mode !== 'offline') {
  try { accessEndpoint(); } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error instanceof AccessError ? error.code : 'ACCESS_CONFIG_INVALID' }));
    process.exit(2);
  }
}

async function run(args: string[], childEnv: Record<string, string>, timeout: number, executable = process.execPath): Promise<number> {
  // A terminal interrupt must reach the runner once; sharing its group causes a second, forced teardown.
  const child = spawn(executable, args, { env: childEnv, stdio: 'inherit', detached: true });
  let stopped = false;
  const killTimers: ReturnType<typeof setTimeout>[] = [];
  const killGroup = () => {
    if (!child.pid) return;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* The child may already have exited. */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
    if (executable === 'node') {
      // e2e's third signal kills its detached app groups; killing only the runner would orphan them.
      // Let the runner's 120s attempt + 30s cleanup budget expire before forcing it.
      killTimers.push(setTimeout(() => child.kill('SIGTERM'), 155_000));
      killTimers.push(setTimeout(() => child.kill('SIGTERM'), 190_000));
      killTimers.push(setTimeout(killGroup, 195_000));
    } else {
      killTimers.push(setTimeout(killGroup, 35_000));
    }
  };
  const timer = setTimeout(stop, timeout);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(stopped ? 130 : code ?? 1));
    });
  } finally {
    clearTimeout(timer);
    for (const killTimer of killTimers) clearTimeout(killTimer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (mode === 'preflight') {
  process.exitCode = await run(['scripts/check-e2e-model.ts'], { ...env, CF_AI_ACCESS_URL: process.env.CF_AI_ACCESS_URL! }, 180_000);
} else {
  const build = await run(['run', 'build:e2e'], env, 180_000);
  if (build !== 0) process.exit(build);
  const runnerEnv = mode === 'offline' ? { ...env, MINAOSI_E2E_OFFLINE: '1' } : { ...env, CF_AI_ACCESS_URL: process.env.CF_AI_ACCESS_URL! };
  process.exitCode = await run(['node_modules/e2e/dist/cli/bin.js', 'run', ...files, ...(mode === 'offline' ? ['--exclude-tag', 'model'] : [])], runnerEnv, 900_000, 'node');
}
