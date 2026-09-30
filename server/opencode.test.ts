import { expect, test } from 'bun:test';
import { reviewWithOpenCode } from './opencode';
import type { HttpFetch } from '../entrypoints/minaosi/review/providers';

const request = { provider: 'opencode-go' as const, model: 'space-bunny-free', blocks: [{ index: 0, text: '誤字' }] };
const typo = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '誤字', to: '修正' }] };
function reportResponse(findings: unknown[]) {
  const chunk = { id: 'fixture-completion', object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'report_findings', arguments: JSON.stringify({ findings }) } }] }, finish_reason: null }] };
  const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return new Response([chunk, end].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

test('OpenCode Goに利用者のキーと正しいモデル・toolを送信する', async () => {
  let calls = 0;
  const fetcher: HttpFetch = async (url, options) => {
    calls++;
    expect(String(url)).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    const headers = new Headers(options?.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-opencode-key');
    expect(headers.get('user-agent')).toBe('minaosi/0.1.0');
    expect(headers.get('x-opencode-session')).toBeTruthy();
    expect(options?.redirect).toBe('error');
    const body = JSON.parse(options?.body as string);
    expect(body.model).toBe('space-bunny-free');
    expect(body.max_tokens).toBe(8192);
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['report_findings']);
    expect(body.messages[0].content).toContain('事実の正誤に関する指摘は出さない');
    return reportResponse([typo]);
  };
  expect(await reviewWithOpenCode(request, 'fixture-opencode-key', fetcher)).toEqual([typo]);
  expect(calls).toBe(1);
});

test('モデルが出典URLを生成しても検索未確認の事実指摘は返さない', async () => {
  const fact = { ...typo, kind: 'fact', source: { url: 'https://example.com', excerpt: '生成された出典' } };
  expect(await reviewWithOpenCode(request, 'fixture-key', async () => reportResponse([typo, fact]))).toEqual([typo]);
});

test('認証失敗の本文を表示・再送しない', async () => {
  let calls = 0;
  const fetcher: HttpFetch = async () => { calls++; return Response.json({ error: { message: 'fixture-private-key private-draft' } }, { status: 401 }); };
  await expect(reviewWithOpenCode(request, 'fixture-key', fetcher)).rejects.toThrow('OpenCode Goの校閲を完了できませんでした');
  expect(calls).toBe(1);
});

test('モデル違いでは外部送信せず、reportがない返答を空の成功にしない', async () => {
  await expect(reviewWithOpenCode({ ...request, model: 'super-bunny-free' }, 'fixture-key', async () => { throw Error('外部送信禁止'); })).rejects.toThrow('未対応');
  const text = new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: { content: '完了' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await expect(reviewWithOpenCode(request, 'fixture-key', async () => text)).rejects.toThrow('校閲結果が返りませんでした');
});
