import { expect, test } from 'bun:test';
import { hc } from 'hono/client';
import type { AppType } from './app';
import { handleRequest, type Env } from './worker';

test('Hono RPCのクライアントが実際のルートへ原稿とBYOKを送り、型付き結果を受け取る', async () => {
  const env = { LOCAL_OPENCODE_BYOK: 'true' } as Env;
  let reviewed = false;
  const client = hc<AppType>('http://localhost', {
    fetch: (input, init) => handleRequest(new Request(input, init), env, undefined, async (request, key) => {
      expect(request.provider).toBe('opencode-go');
      expect(request.blocks).toEqual([{ index: 0, text: 'こんにちわ' }]);
      expect(key).toBe('fixture-byok');
      reviewed = true;
      return [{ kind: 'typo', block: 0, title: '挨拶の誤字', reason: '正しくはこんにちは', matches: [{ from: 'こんにちわ', to: 'こんにちは' }] }];
    }),
  });
  const response = await client.review.$post({
    json: { provider: 'opencode-go', model: 'space-bunny-free', blocks: [{ index: 0, text: 'こんにちわ' }] },
  }, { headers: { 'x-minaosi-api-key': 'fixture-byok' } });
  expect(response.status).toBe(200);
  if (response.status === 200) expect((await response.json()).findings[0]?.matches?.[0]?.to).toBe('こんにちは');
  expect(reviewed).toBe(true);
});
