import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessEndpoint, accessModelId, accessFetch, accessSession, REQUEST_LIMIT, REQUEST_BYTES_LIMIT } from './support/access-model';

let dir: string;
let server: ReturnType<typeof Bun.serve>;
const originalPath = process.env.PATH;
const originalHome = process.env.HOME;
let status = 200;
let html = false;
let requests: Request[] = [];
let responseBody = '';
const jwt = (exp: number) => `fixture.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
let session: string;
const sdkURL = 'https://access.invalid/compat/chat/completions';
const post = { method: 'POST', body: JSON.stringify({ model: 'fixture-model', messages: [], max_tokens: 9999 }) };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'minaosi-access-test-'));
  const sessionPath = join(dir, 'session');
  await writeFile(join(dir, 'cloudflared'), `#!${process.execPath}\nimport { readFileSync } from 'node:fs';\nif (process.env.OPENCODE_API_KEY || process.env.MISE_AGE_KEY || process.env.CF_AI_ACCESS_URL) process.exit(99);\nconst value = readFileSync(${JSON.stringify(sessionPath)}, 'utf8');\nif (value === 'hang') await new Promise(() => {});\nif (value === 'missing') { console.error('fixture private endpoint and credential'); process.exit(1); }\nprocess.stdout.write(value);\n`, { mode: 0o700 });
  process.env.PATH = `${dir}:${originalPath}`;
  process.env.HOME = dir;
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(request);
    const body = await request.json() as { max_tokens: number };
    expect(body.max_tokens).toBe(2048);
    expect(request.headers.get('cf-access-token')).toBe(session);
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.headers.has('cf-aig-authorization')).toBe(false);
    return new Response(responseBody, { status, headers: { 'content-type': html ? 'text/html' : 'application/json', 'location': 'https://private.example/login', 'set-cookie': session } });
  } });
});

beforeEach(async () => {
  session = jwt(Math.floor(Date.now() / 1000) + 3600);
  await writeFile(join(dir, 'session'), session, { mode: 0o600 });
  status = 200; html = false; requests = [];
  responseBody = JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
});

afterAll(async () => {
  server?.stop(true);
  if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('missing or invalid endpoint fails without disclosing its value', () => {
  expect(() => accessEndpoint('')).toThrow('ACCESS_URL_MISSING');
  for (const value of ['https://private.example', 'http://private.example/compat/chat/completions', 'https://key:secret@private.example/compat/chat/completions', 'https://private.example/compat/chat/completions?key=secret']) {
    try { accessEndpoint(value); throw new Error('accepted'); } catch (error) {
      expect(String(error)).toContain('ACCESS_URL_INVALID');
      expect(String(error)).not.toContain('private.example');
      expect(String(error)).not.toContain('secret');
    }
  }
});

test('existing session is attached only inside HTTP transport and response metadata is removed', async () => {
  const fetcher = accessFetch(server.url.href);
  const init = { ...post, headers: { 'content-type': 'application/json' } };
  const response = await fetcher(sdkURL, init);
  expect(response.url).toBe('');
  expect(response.headers.has('location')).toBe(false);
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(init.headers).toEqual({ 'content-type': 'application/json' });
  expect(await response.json()).toHaveProperty('choices');
  expect(requests).toHaveLength(1);
});

test('missing, invalid and expired sessions fail before model HTTP and never start login', async () => {
  for (const [value, code] of [['missing', 'ACCESS_SESSION_MISSING'], ['invalid', 'ACCESS_SESSION_INVALID'], [jwt(1), 'ACCESS_SESSION_EXPIRED']]) {
    await writeFile(join(dir, 'session'), value!);
    await expect(accessFetch(server.url.href)(sdkURL, post)).rejects.toThrow(code);
  }
  expect(requests).toHaveLength(0);
});

test('cancelled session lookup terminates the subprocess', async () => {
  await writeFile(join(dir, 'session'), 'hang');
  await expect(accessSession(server.url.href, AbortSignal.timeout(50))).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test('401, 403 and redirects fail without upstream body or login URL', async () => {
  responseBody = `private.example ${session}`;
  for (const value of [401, 403, 302]) {
    status = value;
    try { await accessFetch(server.url.href)(sdkURL, post); throw new Error('accepted'); } catch (error) {
      expect(String(error)).toContain('ACCESS_DENIED');
      expect(String(error)).not.toContain('private.example');
      expect(String(error)).not.toContain(session);
    }
  }
  expect(requests).toHaveLength(3);
});

test('unsupported model, HTML, malformed JSON and empty choices cannot pass as model success', async () => {
  status = 400;
  await expect(accessFetch(server.url.href)(sdkURL, post)).rejects.toThrow('ACCESS_MODEL_HTTP');
  status = 200; html = true;
  await expect(accessFetch(server.url.href)(sdkURL, post)).rejects.toThrow('ACCESS_RESPONSE_INVALID');
  html = false; responseBody = '{broken';
  await expect(accessFetch(server.url.href)(sdkURL, post)).rejects.toThrow('ACCESS_RESPONSE_INVALID');
  responseBody = JSON.stringify({ choices: [] });
  await expect(accessFetch(server.url.href)(sdkURL, post)).rejects.toThrow('ACCESS_RESPONSE_INVALID');
});

test('successful response cannot echo the endpoint or session into artifacts', async () => {
  // Slash/unicode escapes are decoded by the SDK and must be removed before it receives JSON.
  responseBody = JSON.stringify({ choices: [{ message: { content: `${server.url.href} ${session}` } }], metadata: { [session]: server.url.host } })
    .replaceAll('/', '\\/').replaceAll('.', '\\u002e');
  const response = await accessFetch(server.url.href)(sdkURL, post);
  const body = await response.text();
  expect(body).not.toContain(server.url.host);
  expect(body).not.toContain(session);
  expect(body).not.toContain('fixture');
  expect(JSON.stringify(JSON.parse(body))).not.toContain(session);
});

test('request budget includes every HTTP attempt, even SDK retries', async () => {
  const fetcher = accessFetch(server.url.href);
  for (let i = 0; i < REQUEST_LIMIT; i++) await fetcher(sdkURL, post);
  await expect(fetcher(sdkURL, post)).rejects.toThrow('ACCESS_REQUEST_LIMIT');
  expect(requests).toHaveLength(REQUEST_LIMIT);
}, 15_000);

test('oversized input, including accumulated history, fails before session or HTTP', async () => {
  await writeFile(join(dir, 'session'), 'missing');
  await expect(accessFetch(server.url.href)(sdkURL, { method: 'POST', body: JSON.stringify({ messages: [{ content: 'x'.repeat(REQUEST_BYTES_LIMIT) }] }) })).rejects.toThrow('ACCESS_INPUT_LIMIT');
  expect(requests).toHaveLength(0);
});


test('global model selection maps to Access OpenCode Go routing without an implicit model fallback', () => {
  expect(accessModelId('mimo-v2.6-flash')).toBe('custom-opencode-go/mimo-v2.6-flash');
  expect(() => accessModelId('')).toThrow('E2E_MODEL_MISSING');
  for (const value of ['workers-ai/@cf/example/model', 'https://private.example/key', 'secret value']) {
    try { accessModelId(value); throw new Error('accepted'); } catch (error) {
      expect(String(error)).toContain('E2E_MODEL_INVALID');
      expect(String(error)).not.toContain(value);
    }
  }
});

test('OpenCode operation session is stable within a worker and isolated between transports', async () => {
  const first = accessFetch(server.url.href);
  await first(sdkURL, post);
  await first(sdkURL, post);
  await accessFetch(server.url.href)(sdkURL, post);
  const sessions = requests.map(request => request.headers.get('x-opencode-session'));
  expect(sessions[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(sessions[1]).toBe(sessions[0]);
  expect(sessions[2]).not.toBe(sessions[0]);
  expect(requests.every(request => request.headers.get('user-agent') === 'wwwyo-e2e/0.1')).toBe(true);
});
