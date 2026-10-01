import { expect, test } from 'bun:test';
import { fetchWithoutRedirects } from './fetch';

test('リダイレクト先にAPIキーを転送せず、レスポンス本文を閉じる', async () => {
  let calls = 0;
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 307, headers: { location: 'https://untrusted.example/collect' } });
  await expect(fetchWithoutRedirects(async (url, init) => {
    calls++;
    expect(String(url)).toBe('https://provider.example/review');
    expect(init?.redirect).toBe('manual');
    return response;
  }, 'https://provider.example/review', { headers: { authorization: 'Bearer fixture-key' } })).rejects.toThrow('校閲APIのリダイレクトを拒否しました');
  expect(calls).toBe(1);
  expect(cancelled).toBe(true);
});
