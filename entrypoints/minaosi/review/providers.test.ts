import { describe, expect, test } from 'bun:test';
import { isReviewProvider, review, type HttpFetch, type ReviewRequest } from './providers';

const finding = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '誤字', to: '修正' }] };
const request: ReviewRequest = { type: 'minaosi:review', provider: 'anthropic', model: 'fixture-model', blocks: [{ index: 0, text: '原稿' }] };
const endpoint = 'https://review.example.com/review';

describe('review relay', () => {
  test('ログインなしでキーをヘッダーに渡し、本文には原稿と接続先だけを含める', async () => {
    let called = false;
    const fetcher = (async (url, options) => {
      called = true;
      expect(String(url)).toBe(endpoint);
      expect(options?.headers).toEqual({ 'content-type': 'application/json', 'x-minaosi-api-key': 'fixture-key' });
      expect(JSON.parse(options?.body as string)).toEqual({ provider: request.provider, model: request.model, blocks: request.blocks });
      expect(options?.redirect).toBe('error');
      expect(options?.credentials).toBe('omit');
      return Response.json({ findings: [finding] });
    }) as HttpFetch;
    expect(await review(request, 'fixture-key', endpoint, fetcher)).toEqual([finding]);
    expect(called).toBe(true);
  });

  test('キーを外部HTTPやURLの認証・クエリへ送信しない', async () => {
    for (const url of ['http://review.example.com/review', 'https://user:password@review.example.com/review', endpoint + '?key=secret']) {
      await expect(review(request, 'fixture-key', url)).rejects.toThrow();
    }
  });

  test('中継先のエラーを表示し、別の接続先にフォールバックしない', async () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return Response.json({ error: '接続設定が未完了' }, { status: 503 }); }) as HttpFetch;
    await expect(review(request, 'fixture-key', endpoint, fetcher)).rejects.toThrow('接続設定が未完了');
    expect(calls).toBe(1);
  });

  test('不正な結果は失敗にし、一次出典がないfactは除外する', async () => {
    const fetcher = (async () => Response.json({ findings: [{ ...finding, kind: 'fact' }] })) as HttpFetch;
    expect(await review(request, 'fixture-key', endpoint, fetcher)).toEqual([]);
    await expect(review(request, 'fixture-key', endpoint, (async () => Response.json({})) as HttpFetch)).rejects.toThrow('形式が不正');
  });
});


test('providerは対応する2値だけを受け付け、継承プロパティを拒否する', () => {
  expect(isReviewProvider('anthropic')).toBe(true);
  expect(isReviewProvider('openai')).toBe(true);
  for (const value of ['__proto__', 'constructor', 'toString', null, undefined, {}]) {
    expect(isReviewProvider(value)).toBe(false);
  }
});
