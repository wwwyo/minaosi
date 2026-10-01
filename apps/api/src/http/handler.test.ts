import { describe, expect, spyOn, test } from 'bun:test';
import { handleRequest, type Env } from './handler';

const env: Env = { CLOUDFLARE_ACCOUNT_ID: 'fixture-account', CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway', CF_AIG_TOKEN: 'fixture-cf-token' };
const body = { provider: 'openai' as const, model: 'gpt-5.4-mini', blocks: [{ index: 0, text: '原稿' }] };
function request(value: unknown = body, headers: Record<string, string> = {}, url = 'https://review.example.com/review') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-minaosi-api-key': 'fixture-key', ...headers }, body: JSON.stringify(value) });
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

  test('原稿の上限は受理し、空・超過・不正なブロック番号は外部送信しない', async () => {
    const accepted = [
      { ...body, mode: 'byok', blocks: [{ index: Number.MAX_SAFE_INTEGER, text: 'a'.repeat(80_000) }] },
      { ...body, blocks: Array.from({ length: 2000 }, (_, index) => ({ index, text: '' })) },
    ];
    for (const value of accepted) {
      expect((await handleRequest(request(value), env, async () => [])).status).toBe(200);
    }
    const rejected = [
      { ...body, blocks: [] },
      { ...body, blocks: Array.from({ length: 2001 }, (_, index) => ({ index, text: '' })) },
      ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(index => ({ ...body, blocks: [{ index, text: '原稿' }] })),
    ];
    for (const value of rejected) expect((await handleRequest(request(value), env, neverReview)).status).toBe(400);
  });

  test('Content-Lengthが過少でも受信したバイト数で巨大な本文を拒否する', async () => {
    const response = await handleRequest(request({ ...body, extra: 'あ'.repeat(90_000) }, { 'content-length': '1' }), env, neverReview);
    expect(response.status).toBe(413);
  });

  test('Zodの検証エラーにも入力内容や認証情報を含めない', async () => {
    const logs = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const response = await handleRequest(request({ ...body, model: '秘密の原稿 fixture-key', apiKey: 'fixture-private' }), env, neverReview);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: '校閲リクエストの形式が不正です' });
      expect(JSON.stringify(logs.mock.calls)).not.toContain('秘密の原稿');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('fixture-key');
      expect(JSON.stringify(logs.mock.calls)).not.toContain('fixture-private');
    } finally { logs.mockRestore(); }
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

const standardEnv: Env = {
  ...env, AI: { run: () => { throw new Error('AIを呼んではいけない'); } } as Env['AI'], DEFAULT_REVIEW_MODEL: '@cf/deepseek-ai/deepseek-v4-flash-0731',
  REVIEW_CONCURRENCY: { getByName: () => ({ acquire: async () => 'fixture-lease', release: async () => {} }) },
};
const neverStandard = async () => { throw new Error('AI bindingを呼んではいけない'); };
test('標準モードはキー・接続先・モデルをサーバーの設定で固定する', async () => {
  // Gateway用secretがなくても、AI bindingだけで標準校閲は成立する。
  const minimal = { AI: standardEnv.AI, DEFAULT_REVIEW_MODEL: standardEnv.DEFAULT_REVIEW_MODEL, REVIEW_CONCURRENCY: standardEnv.REVIEW_CONCURRENCY };
  const response = await handleRequest(
    request({ ...body, mode: 'default', model: 'client-model', provider: 'openai' }, { 'x-minaosi-api-key': '' }),
    minimal, neverReview, neverReview,
    async (input, bindings) => {
      expect(input).toEqual({ model: '@cf/deepseek-ai/deepseek-v4-flash-0731', blocks: body.blocks });
      expect(bindings.AI).toBe(minimal.AI);
      return [];
    },
  );
  expect(response.status).toBe(200);
});

test('標準モードの運営設定が未完了なら実行しない', async () => {
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }, { 'x-minaosi-api-key': '' }), env, neverReview)).status).toBe(503);
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }), { ...standardEnv, AI: undefined }, neverReview, neverReview, neverStandard)).status).toBe(503);
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }), { ...standardEnv, DEFAULT_REVIEW_MODEL: '../../evil' }, neverReview)).status).toBe(503);
});

test('DeepSeekのBYOKは利用者のキーを使い、標準モードはキーを送信しない', async () => {
  const deepseek = { ...body, provider: 'deepseek' as const, model: 'deepseek-flash' };
  const result = await handleRequest(request(deepseek), standardEnv, async (input, key) => {
    expect(input).toEqual(deepseek);
    expect(key).toBe('fixture-key');
    return [];
  });
  expect(result.status).toBe(200);
  expect((await handleRequest(request(deepseek, { 'x-minaosi-api-key': '' }), standardEnv, neverReview)).status).toBe(401);
  // 標準モードは利用者キーを要求せず、AI binding経路へ流す。
  let standardKeyless = false;
  const standard = await handleRequest(
    request({ mode: 'default', blocks: body.blocks }, { 'x-minaosi-api-key': '' }),
    standardEnv, neverReview, neverReview,
    async (input) => { standardKeyless = true; expect(input.model).toBe('@cf/deepseek-ai/deepseek-v4-flash-0731'); return []; },
  );
  expect(standard.status).toBe(200);
  expect(standardKeyless).toBe(true);
});

test('BYOKのキー未設定・モード指定の誤りを標準課金へフォールバックしない', async () => {
  expect((await handleRequest(request(body, { 'x-minaosi-api-key': '' }), standardEnv, neverReview)).status).toBe(401);
  expect((await handleRequest(request({ ...body, mode: 'other' }), standardEnv, neverReview)).status).toBe(400);
});

test('ローカルOpenCode BYOKだけはGateway未設定でも利用者のキーで校閲する', async () => {
  const opencode = { ...body, provider: 'opencode-go' as const, model: 'space-bunny-free' };
  const result = await handleRequest(request(opencode, {}, 'http://127.0.0.1:8787/review'), { ...env, CF_AIG_TOKEN: '', LOCAL_OPENCODE_BYOK: 'true' }, neverReview, async (input, key) => {
    expect(input).toEqual(opencode);
    expect(key).toBe('fixture-key');
    return [];
  });
  expect(result.status).toBe(200);
  expect((await handleRequest(request(opencode, { 'x-minaosi-api-key': '' }), { ...env, LOCAL_OPENCODE_BYOK: 'true' }, neverReview, neverReview)).status).toBe(401);
});

test('本番と標準モードをOpenCodeの直接接続へ流さない', async () => {
  const opencode = { ...body, provider: 'opencode-go' as const, model: 'space-bunny-free', LOCAL_OPENCODE_BYOK: 'true' };
  expect((await handleRequest(request(opencode), env, neverReview, neverReview)).status).toBe(503);
  expect((await handleRequest(request(opencode), { ...env, LOCAL_OPENCODE_BYOK: 'true' }, neverReview, neverReview)).status).toBe(503);
  // 標準モードにproviderの選択肢はなく、OpenCode Goへ逃がす設定も存在しない。
  expect((await handleRequest(request({ mode: 'default', blocks: body.blocks }), { ...standardEnv, LOCAL_OPENCODE_BYOK: 'true' }, neverReview, neverReview, async () => [])).status).toBe(200);
});

test('成功・失敗のログに原稿・キー・URL・上流エラー本文を残さない', async () => {
  const success = spyOn(console, 'log').mockImplementation(() => {});
  const failure = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await handleRequest(request(), env, async () => []);
    const response = await handleRequest(request(body, {}, 'https://review.example.com/review?private=fixture-key'), env, async () => {
      throw new Error('原稿 fixture-key fixture-cf-token');
    });
    expect(response.status).toBe(502);
    const records = [success.mock.calls[0]?.[0], failure.mock.calls[0]?.[0]];
    for (const record of records) {
      expect(record).toEqual({ event: 'review_request_completed', requestId: expect.any(String), status: expect.any(Number), durationMs: expect.any(Number) });
    }
    expect(records.map((record) => record.status)).toEqual([200, 502]);
    const serialized = JSON.stringify(records);
    for (const secret of ['原稿', 'fixture-key', 'fixture-cf-token', 'review.example.com', 'private=']) expect(serialized).not.toContain(secret);
  } finally {
    success.mockRestore();
    failure.mockRestore();
  }
});

test('bindingの例外も安全な500応答とメタデータだけにする', async () => {
  const failure = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await handleRequest(request(body, { origin: 'chrome-extension://fixture-extension' }), { ...env, ALLOWED_ORIGINS: 'chrome-extension://fixture-extension', REVIEW_RATE_LIMIT: { limit: async () => { throw new Error('fixture-key 原稿'); } } }, neverReview);
    expect(response.status).toBe(500);
    expect(response.headers.get('access-control-allow-origin')).toBe('chrome-extension://fixture-extension');
    expect(await response.text()).not.toContain('fixture-key');
    expect(JSON.stringify(failure.mock.calls)).not.toContain('原稿');
  } finally {
    failure.mockRestore();
  }
});

describe('標準サービスの同時実行枠', () => {
  const standardRequest = () => request({ mode: 'default', blocks: body.blocks });

  test('上限到達時はAIを呼ばず429を返し、他の実行枠を解放しない', async () => {
    const response = await handleRequest(standardRequest(), {
      ...standardEnv,
      REVIEW_CONCURRENCY: { getByName: (name) => {
        expect(name).toBe('standard');
        return { acquire: async () => null, release: async () => { throw new Error('他の枠を解放してはいけない'); } };
      } },
    }, neverReview);
    expect(response.status).toBe(429);
  });

  test('校閲の成功・失敗とも取得した枠だけを解放する', async () => {
    for (const fail of [false, true]) {
      const events: string[] = [];
      const response = await handleRequest(standardRequest(), {
        ...standardEnv,
        REVIEW_CONCURRENCY: { getByName: () => ({
          acquire: async () => { events.push('acquire'); return 'own-lease'; },
          release: async (id) => { events.push(`release:${id}`); },
        }) },
      }, neverReview, neverReview, async () => {
        events.push('review');
        if (fail) throw new Error('上流が失敗');
        return [];
      });
      expect(response.status).toBe(fail ? 502 : 200);
      expect(events).toEqual(['acquire', 'review', 'release:own-lease']);
    }
  });

  test('実行枠のbindingが欠ける・取得が失敗する場合にAIを呼ばない', async () => {
    expect((await handleRequest(standardRequest(), { ...standardEnv, REVIEW_CONCURRENCY: undefined }, neverReview)).status).toBe(503);
    expect((await handleRequest(standardRequest(), {
      ...standardEnv,
      REVIEW_CONCURRENCY: { getByName: () => ({ acquire: async () => { throw new Error('fixture-key'); }, release: async () => {} }) },
    }, neverReview)).status).toBe(500);
  });

  test('BYOKは運営負担の実行枠を使わない', async () => {
    const response = await handleRequest(request(), {
      ...standardEnv,
      REVIEW_CONCURRENCY: { getByName: () => { throw new Error('標準サービスの枠を使ってはいけない'); } },
    }, async () => []);
    expect(response.status).toBe(200);
  });

  test('解放の失敗で校閲結果を失わず、生の例外をログに残さない', async () => {
    const failure = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handleRequest(standardRequest(), {
        ...standardEnv,
        REVIEW_CONCURRENCY: { getByName: () => ({ acquire: async () => 'own-lease', release: async () => { throw new Error('fixture-key 原稿'); } }) },
      }, neverReview, neverReview, async () => []);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ findings: [] });
      expect(failure.mock.calls).toEqual([[{ event: 'review_lease_release_failed' }]]);
    } finally { failure.mockRestore(); }
  });
});
