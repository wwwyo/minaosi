import { expect, test } from 'bun:test';
import { hc } from 'hono/client';
import type { AppType } from './app';
import { handleRequest, type Env } from './handler';

test('Hono RPCのクライアントが実際のルートへ原稿とBYOKを送り、型付き結果を受け取る', async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_AI_GATEWAY_ID: 'g', CF_AIG_TOKEN: 't' } as Env;
  let reviewed = false;
  const client = hc<AppType>('http://localhost', {
    fetch: (input, init) => handleRequest(new Request(input, init), env, async (request, key) => {
      expect(request.provider).toBe('deepseek');
      expect(request.blocks).toEqual([{ index: 0, text: 'こんにちわ' }]);
      expect(key).toBe('fixture-byok');
      reviewed = true;
      return [{ kind: 'typo', block: 0, title: '挨拶の誤字', reason: '正しくはこんにちは', matches: [{ from: 'こんにちわ', to: 'こんにちは' }] }];
    }, undefined, async () => ({ ok: true })),
  });
  const response = await client.review.$post({
    json: { provider: 'deepseek', model: 'deepseek-flash', blocks: [{ index: 0, text: 'こんにちわ' }] },
  }, { headers: { 'x-minaosi-api-key': 'fixture-byok', 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX' } });
  expect(response.status).toBe(200);
  if (response.status === 200) expect((await response.json()).findings[0]?.matches?.[0]?.to).toBe('こんにちは');
  expect(reviewed).toBe(true);
});
