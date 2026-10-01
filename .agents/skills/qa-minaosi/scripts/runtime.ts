#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [command, runId] = process.argv.slice(2);
if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Usage: runtime.ts prepare|api|web|browser|doctor|doctor-ui|service|cleanup <run-id>');
const root = resolve(import.meta.dir, '../../../..');
const evidence = join(root, '.agent/qa/runs', runId);
const file = (name: string) => join(evidence, name);
const save = (name: string, value: string) => writeFileSync(file(name), value);
function shell(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  return { status: result.exitCode, text: result.stdout.toString().trim() };
}
if (command === 'prepare') {
  if (existsSync(evidence)) throw new Error('Use a new run-id; existing evidence is never overwritten.');
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  // WXT watcher events use canonical paths; /var vs /private/var can watch its own output.
  const runtime = realpathSync(mkdtempSync(join(tmpdir(), 'minaosi-qa-')));
  save('runtime.path', runtime);
  save('source-head.txt', shell(['git', 'rev-parse', 'HEAD']).text + '\n');
  save('source-status.txt', shell(['git', 'status', '--short']).text + '\n');
  // Source snapshots keep QA builds and state out of another session's output dirs.
  for (const name of ['server', 'entrypoints', 'public', 'cloudflare.config.ts', 'wrangler.config.ts', 'wxt.config.ts', 'package.json', 'bun.lock', 'tsconfig.json']) {
    if (existsSync(join(root, name))) cpSync(join(root, name), join(runtime, name), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(runtime, 'node_modules'), 'dir');
  save('ports.json', JSON.stringify({ api: 18787, web: 13011 }));
  console.log(evidence);
  process.exit(0);
}
const runtime = readFileSync(file('runtime.path'), 'utf8').trim();
if (!realpathSync(runtime).startsWith(join(realpathSync(tmpdir()), 'minaosi-qa-'))) throw new Error('Unexpected runtime path.');
const ports = JSON.parse(readFileSync(file('ports.json'), 'utf8')) as { api: number; web: number };
function listeners(port: number): number[] {
  const output = shell(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).text;
  return [...new Set(output.split('\n').filter(Boolean).map(Number))];
}
function belongsTo(pid: number, owner: number): boolean {
  for (let i = 0; pid > 1 && i < 40; i++) {
    if (pid === owner) return true;
    pid = Number(shell(['ps', '-o', 'ppid=', '-p', String(pid)]).text);
  }
  return false;
}
if (command === 'api' || command === 'web' || command === 'browser') {
  const port = command === 'api' ? ports.api : ports.web;
  if (command !== 'browser' && listeners(port).length) throw new Error(`Port ${port} is occupied; change ports.json before launching. Never drive/stop the other instance.`);
  let args: string[];
  if (command === 'browser') {
    const binary = process.env.MINAOSI_QA_CHROME;
    if (!binary || !existsSync(binary)) throw new Error('Set MINAOSI_QA_CHROME to an installed Chrome for Testing executable; do not use the personal browser.');
    if (!existsSync(join(runtime, '.output/chrome-mv3-dev/manifest.json'))) throw new Error('Start web and wait for the development extension build first.');
    const landing = `data:text/html,${encodeURIComponent(`<title>minaosi QA ${runId}</title><p>Isolated QA browser</p>`)}`;
    args = [binary, `--user-data-dir=${join(runtime, 'chrome-profile')}`, `--load-extension=${join(runtime, '.output/chrome-mv3-dev')}`, landing];
  } else {
    args = command === 'api'
      ? ['bun', 'run', 'api:dev', '--', '--port', String(ports.api), '--persist-to', join(runtime, 'worker-state')]
      : ['node', join(import.meta.dir, 'start-web.mjs'), runtime, String(ports.web)];
  }
  save(`${command}.pid`, String(process.pid));
  save(`${command}.action.txt`, JSON.stringify({ cwd: runtime, args }, null, 2));
  const child = Bun.spawn(args, { cwd: runtime, env: { ...process.env, WXT_REVIEW_API_URL: `http://127.0.0.1:${ports.api}/review` }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  process.exit(await child.exited);
}
if (command === 'doctor' || command === 'doctor-ui') {
  const owner = Number(readFileSync(file('api.pid'), 'utf8'));
  const pids = listeners(ports.api);
  const owned = pids.length > 0 && pids.every((pid) => belongsTo(pid, owner));
  save('doctor-ownership.json', JSON.stringify({ owner, listeners: pids, owned }, null, 2));
  if (!owned) throw new Error('API listener is not a descendant of this run launcher.');
  const response = await fetch(`http://127.0.0.1:${ports.api}/health`, { signal: AbortSignal.timeout(5000) });
  const body = await response.text();
  save('doctor-health.json', body);
  if (response.status !== 200 || JSON.parse(body).ok !== true) throw new Error('Health check failed.');
  if (command === 'doctor-ui') {
    const webOwner = Number(readFileSync(file('web.pid'), 'utf8'));
    const webPids = listeners(ports.web);
    if (!webPids.length || !webPids.every((pid) => belongsTo(pid, webOwner))) throw new Error('Web listener not owned by this run.');
    const manifestPath = join(runtime, '.output/chrome-mv3-dev/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'minaosi' || !manifest.side_panel || !manifest.options_ui) throw new Error('Expected extension entrypoints missing.');
    save('doctor-manifest.json', JSON.stringify(manifest, null, 2));
    const browserOwner = Number(readFileSync(file('browser.pid'), 'utf8'));
    const processes = shell(['ps', '-axo', 'pid=,args=']).text.split('\n');
    const ownsProfile = processes.some((line) => line.includes(`--user-data-dir=${join(runtime, 'chrome-profile')}`) && belongsTo(Number(line.trim().split(/\s+/)[0]), browserOwner));
    if (!ownsProfile) throw new Error('Owned isolated browser profile not running.');
    save('doctor-ui.txt', 'Owned web listener, extension manifest and isolated browser process verified. Check note test-account login in the UI before driving.\n');
  }
  console.log('doctor passed (health only; AI credentials/extension not verified)');
  process.exit(0);
}
if (command === 'service') {
  const doctor = Bun.spawnSync(['bun', import.meta.filename, 'doctor', runId], { stdout: 'inherit', stderr: 'inherit' });
  if (doctor.exitCode) process.exit(doctor.exitCode);
  const cases = [
    { id: 'service.1', route: '/health', method: 'GET', status: 200 },
    { id: 'service.2', route: '/health', method: 'GET', status: 403, origin: 'https://minaosi-qa.invalid' },
    { id: 'service.3', route: '/review', method: 'GET', status: 405 },
    { id: 'service.4', route: '/review', method: 'POST', status: 400, body: '{' },
  ];
  for (const test of cases) {
    const headers: Record<string, string> = {};
    if (test.origin) headers.origin = test.origin;
    if (test.body) headers['content-type'] = 'application/json';
    const url = `http://127.0.0.1:${ports.api}${test.route}`;
    save(`${test.id}-action.json`, JSON.stringify({ feature: 'service', subfeature: test.id, entrypoint: `${test.method} ${test.route}`, url, headers, body: test.body }, null, 2));
    const response = await fetch(url, { method: test.method, headers, body: test.body, signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    save(`${test.id}-body.json`, body);
    save(`${test.id}-response.json`, JSON.stringify({ status: response.status, headers: Object.fromEntries(response.headers) }, null, 2));
    const json = JSON.parse(body);
    const expected = test.id === 'service.1' ? json.ok === true && typeof json.configured === 'boolean'
      : json.error === ({ 'service.2': '許可されていない接続元です', 'service.3': 'POST を使ってください', 'service.4': 'JSON 形式が不正です' } as Record<string, string>)[test.id];
    if (response.status !== test.status || !expected || response.headers.get('cache-control') !== 'no-store') throw new Error(`${test.id} failed; evidence saved.`);
    console.log(`${test.id}: ${response.status} passed`);
  }
  save('service-result.txt', 'service.1–service.4 passed; no AI request sent\n');
  process.exit(0);
}
if (command === 'cleanup') {
  for (const name of ['api', 'web', 'browser']) {
    if (!existsSync(file(`${name}.pid`))) continue;
    const pid = Number(readFileSync(file(`${name}.pid`), 'utf8'));
    if (shell(['ps', '-p', String(pid), '-o', 'pid=']).text) throw new Error(`${name} launcher is still alive. Close only its recorded Orca terminal first.`);
  }
  if (listeners(ports.api).length || listeners(ports.web).length) throw new Error('A QA port remains occupied. Inspect ownership; do not kill by name.');
  rmSync(runtime, { recursive: true });
  const required = ['runtime.path', 'source-head.txt', 'source-status.txt'];
  if (existsSync(file('service-result.txt'))) required.push('doctor-ownership.json', 'doctor-health.json', 'service.1-action.json', 'service.1-body.json', 'service.4-response.json');
  for (const name of required) if (!existsSync(file(name))) throw new Error(`Evidence missing after cleanup: ${name}`);
  save('cleanup-result.txt', 'Owned launchers exited; QA ports free; runtime removed; evidence survived.\n');
  console.log('cleanup passed; evidence survived');
  process.exit(0);
}
throw new Error(`Unknown command: ${command}`);
