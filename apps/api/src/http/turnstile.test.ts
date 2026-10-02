import { expect, test } from 'bun:test';
import type { HttpFetch } from '../review/schema';
import { handleRequest, type Env } from './handler';
import { TURNSTILE_TEST_SITE_KEY, verifyTurnstile, type TurnstileVerifier } from './turnstile';

const PROD_ENV = { TURNSTILE_SITE_KEY: '0x4AAAAAAA-real-sitekey', TURNSTILE_SECRET_KEY: 'real-secret' };
const CHECK = { token: 'token-abc', remoteip: '203.0.113.10', hostname: 'api.example.com' };

const siteverify = (body: unknown, status = 200): HttpFetch =>
  async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('siteverifyがsuccess=true・hostname/action一致なら通す', async () => {
  const calls: { url: string; body: { secret?: string; response?: string; remoteip?: string } }[] = [];
  const fetcher: HttpFetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json({ success: true, hostname: 'api.example.com', action: 'review' });
  };
  const result = await verifyTurnstile(CHECK, PROD_ENV, fetcher);
  expect(result).toEqual({ ok: true });
  // トークン・secret・呼び出し元IPだけを送り、原稿やAPIキーは送らない
  expect(calls).toEqual([{ url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', body: { secret: 'real-secret', response: 'token-abc', remoteip: '203.0.113.10' } }]);
});

test.each([
  ['success=false', { success: false, 'error-codes': ['invalid-input-response'] }],
  ['hostname不一致', { success: true, hostname: 'evil.example.com', action: 'review' }],
  ['action不一致', { success: true, hostname: 'api.example.com', action: 'login' }],
  ['送っていないcdataが返る', { success: true, hostname: 'api.example.com', action: 'review', cdata: 'x' }],
])('siteverifyが拒否条件を返すと403（%s）', async (_name, body) => {
  const result = await verifyTurnstile(CHECK, PROD_ENV, siteverify(body));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.status).toBe(403);
});

test('siteverifyが落ちる・タイムアウトすると503', async () => {
  const down: HttpFetch = async () => { throw new Error('network down'); };
  expect(await verifyTurnstile(CHECK, PROD_ENV, down)).toMatchObject({ ok: false, status: 503 });
  expect(await verifyTurnstile(CHECK, PROD_ENV, siteverify({ success: false }, 500))).toMatchObject({ ok: false, status: 503 });
});

test('トークン欠落・超過長はsiteverifyを呼ばず403', async () => {
  let called = false;
  const fetcher: HttpFetch = async () => { called = true; return Response.json({ success: true }); };
  for (const token of ['', 'x'.repeat(2049)]) {
    expect(await verifyTurnstile({ ...CHECK, token }, PROD_ENV, fetcher)).toMatchObject({ ok: false, status: 403 });
  }
  expect(called).toBe(false);
});

test('secret未設定かつテストsitekey以外はfail closedの503', async () => {
  const result = await verifyTurnstile(CHECK, { TURNSTILE_SITE_KEY: '0x4AAAAAAA-real-sitekey' }, siteverify({ success: true }));
  expect(result).toMatchObject({ ok: false, status: 503 });
});

test('テストsitekeyだけの環境はテストsecretで検証し、dummy応答の固定値を許容する', async () => {
  let sentSecret = '';
  const fetcher: HttpFetch = async (_input, init) => {
    sentSecret = JSON.parse(String(init?.body)).secret;
    return Response.json({ success: true, hostname: 'localhost', action: 'test', cdata: 'test-data' });
  };
  const result = await verifyTurnstile(CHECK, { TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY }, fetcher);
  expect(sentSecret).toBe('1x0000000000000000000000000000000AA');
  expect(result).toEqual({ ok: true });
});

test('POST /reviewはトークン・rate limit・siteverifyの順で入口を通す', async () => {
  let rateLimited = false;
  let verified = false;
  const env: Env = {
    TURNSTILE_SECRET_KEY: 'real-secret',
    REVIEW_RATE_LIMIT: { limit: async () => { rateLimited = true; return { success: true }; } },
  };
  const post = (headers: Record<string, string>, verifier?: TurnstileVerifier) =>
    handleRequest(new Request('http://localhost/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ mode: 'default', blocks: [{ index: 0, text: 'こんにちは' }] }),
    }), env, undefined, undefined, verifier);

  // トークンなし: 形式チェックで403。rate limit・siteverify のどちらも消費しない
  expect((await post({})).status).toBe(403);
  expect(rateLimited).toBe(false);
  expect(verified).toBe(false);

  // 検証失敗: rate limit は通過するが siteverify の結果をそのまま返す
  expect((await post({ 'cf-turnstile-response': 'x' }, async () => { verified = true; return { ok: false, status: 403, error: '人間性の確認に失敗しました。もう一度お試しください' }; })).status).toBe(403);
  expect((await post({ 'cf-turnstile-response': 'x' }, async () => { verified = true; return { ok: false, status: 503, error: '確認サービスへの接続に失敗しました' }; })).status).toBe(503);
  expect(rateLimited).toBe(true);

  // rate limit 超過: siteverify を呼ばず429（偽トークン連打で外部呼出しを増幅させない）
  verified = false;
  const limited = await handleRequest(new Request('http://localhost/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-turnstile-response': 'x' },
    body: JSON.stringify({ mode: 'default', blocks: [{ index: 0, text: 'こんにちは' }] }),
  }), { ...env, REVIEW_RATE_LIMIT: { limit: async () => ({ success: false }) } }, undefined, undefined,
    async () => { verified = true; return { ok: true }; });
  expect(limited.status).toBe(429);
  expect(verified).toBe(false);

  // 検証成功なら校閲へ進む（AI未設定の503に到達する）
  const ok = await post({ 'cf-turnstile-response': 'x' }, async (input) => {
    expect(input).toEqual({ token: 'x', remoteip: null, hostname: 'localhost' });
    return { ok: true };
  });
  expect(ok.status).toBe(503);
});

test('GET /turnstileは拡張のオリジンだけに埋め込みを許すwidgetページを返す', async () => {
  const page = await handleRequest(new Request('http://localhost/turnstile'), { TURNSTILE_SITE_KEY: '0x4AAAAAAA-real-sitekey' });
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain('frame-ancestors chrome-extension: moz-extension: safari-web-extension:');
  expect(await page.text()).toContain('ancestorOrigins');
  // sitekey 未設定は fail closed
  expect((await handleRequest(new Request('http://localhost/turnstile'), {})).status).toBe(503);
});
