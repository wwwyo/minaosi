import { describe, expect, test } from 'bun:test';
import { handleRequest, type Env } from './worker';

const env: Env = { CLOUDFLARE_ACCOUNT_ID: 'fixture-account', CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway', CF_AIG_TOKEN: 'fixture-cf-token' };
const body = { provider: 'openai' as const, model: 'gpt-5.4-mini', blocks: [{ index: 0, text: '原稿' }] };
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request('https://review.example.com/review', { method: 'POST', headers: { 'content-type': 'application/json', 'x-minaosi-api-key': 'fixture-key', ...headers }, body: JSON.stringify(value) });
}
const neverReview = async () => { throw new Error('upstreamを呼んではいけない'); };

describe('anonymous BYOK API', () => {
  test('アカウントもCookieも不要で、利用者のキーだけを指定したproviderへ渡す', async () => {
    let calls = 0;
    const result = await handleRequest(request({ ...body, apiKey: 'body-key', baseURL: 'https://evil.example' }), env, async (input, key, gateway) => {
      calls++;
      expect(input).toEqual(body);
      expect(key).toBe('fixture-key');
      expect(gateway).toBe(env);
      return [];
    });
    expect(calls).toBe(1);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ findings: [] });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  test('利用者のキーなしではGatewayの保存キー・運営者課金へ進まない', async () => {
    const result = await handleRequest(request(body, { 'x-minaosi-api-key': '' }), env, neverReview);
    expect(result.status).toBe(401);
  });

  test('Gateway設定が欠けてもプロバイダーへの直接接続に逃がさない', async () => {
    const result = await handleRequest(request(), { ...env, CF_AIG_TOKEN: '' }, neverReview);
    expect(result.status).toBe(503);
  });

  test('不正なprovider・重複アンカー・巨大原稿を外部送信しない', async () => {
    const invalid = [
      { ...body, provider: '__proto__' },
      { ...body, model: '../../evil' },
      { ...body, blocks: [...body.blocks, ...body.blocks] },
      { ...body, blocks: [{ index: 0, text: 'a'.repeat(80_001) }] },
      { ...body, blocks: [null] },
    ];
    for (const value of invalid) expect((await handleRequest(request(value), env, neverReview)).status).toBe(400);
    expect((await handleRequest(request({ ...body, extra: 'a'.repeat(262_144) }), env, neverReview)).status).toBe(413);
  });

  test('JSON以外・壊れたJSONを拒否する', async () => {
    expect((await handleRequest(request(body, { 'content-type': 'text/plain' }), env, neverReview)).status).toBe(415);
    const malformed = new Request('https://review.example.com/review', { method: 'POST', headers: { 'content-type': 'application/json', 'x-minaosi-api-key': 'fixture-key' }, body: '{' });
    expect((await handleRequest(malformed, env, neverReview)).status).toBe(400);
  });

  test('許可した拡張のOriginだけにCORSを返す', async () => {
    const configured = { ...env, ALLOWED_ORIGINS: 'chrome-extension://fixture-extension' };
    const allowed = await handleRequest(request(body, { origin: 'chrome-extension://fixture-extension' }), configured, async () => []);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('chrome-extension://fixture-extension');
    expect((await handleRequest(request(body, { origin: 'https://evil.example' }), configured, neverReview)).status).toBe(403);
    const preflight = new Request('https://review.example.com/review', { method: 'OPTIONS', headers: { origin: 'chrome-extension://fixture-extension' } });
    expect((await handleRequest(preflight, configured, neverReview)).status).toBe(204);
  });

  test('連続実行の制限を超えたら外部送信しない', async () => {
    const result = await handleRequest(request(), { ...env, REVIEW_RATE_LIMIT: { limit: async () => ({ success: false }) } }, neverReview);
    expect(result.status).toBe(429);
  });

  test('upstreamのエラーに含まれるキーと原稿を応答へ漏らさない', async () => {
    const result = await handleRequest(request(), env, async () => { throw new Error('fixture-key 原稿 fixture-cf-token'); });
    expect(result.status).toBe(502);
    const text = await result.text();
    expect(text).not.toContain('fixture-key');
    expect(text).not.toContain('fixture-cf-token');
    expect(text).not.toContain('原稿');
  });
});

test('不正なツール入力の安全な診断だけを利用者へ返す', async () => {
  const result = await handleRequest(request(), env, async () => { throw new Error('校閲 API が不正なツール入力を返しました'); });
  expect(result.status).toBe(502);
  expect(await result.json()).toEqual({ error: '校閲 API が不正なツール入力を返しました' });
});

const standardEnv: Env = { ...env, DEFAULT_REVIEW_PROVIDER: 'anthropic', DEFAULT_REVIEW_MODEL: 'operator-model', DEFAULT_REVIEW_API_KEY: 'operator-key' };
test('標準モードはキー・接続先・モデルをサーバーの設定で固定する', async () => {
  const response = await handleRequest(request({ ...body, mode: 'default', model: 'client-model', provider: 'openai' }, { 'x-minaosi-api-key': '' }), standardEnv, async (input, key) => {
    expect(input).toEqual({ provider: 'anthropic', model: 'operator-model', blocks: body.blocks });
    expect(key).toBe('operator-key');
    return [];
  });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('operator-key');
});

test('標準モードの運営設定が未完了なら実行しない', async () => {
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }, { 'x-minaosi-api-key': '' }), env, neverReview)).status).toBe(503);
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }), { ...standardEnv, DEFAULT_REVIEW_PROVIDER: '__proto__' }, neverReview)).status).toBe(503);
});

test('BYOKのキー未設定・モード指定の誤りを標準課金へフォールバックしない', async () => {
  expect((await handleRequest(request(body, { 'x-minaosi-api-key': '' }), standardEnv, neverReview)).status).toBe(401);
  expect((await handleRequest(request({ ...body, mode: 'other' }), standardEnv, neverReview)).status).toBe(400);
});
