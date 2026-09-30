import { describe, expect, test } from 'bun:test';
import { buildOpenAIRequest, parseOpenAIReport, review, type ReviewRequest } from './providers';

const finding = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '誤字', to: '修正' }] };
const anthropicReport = { content: [{ type: 'tool_use', name: 'report_findings', input: { findings: [finding] } }] };
const openaiReport = (input: unknown) => ({ status: 'completed', output: [{ type: 'function_call', name: 'report_findings', arguments: JSON.stringify(input) }] });
const request: ReviewRequest = { type: 'minaosi:review', provider: 'anthropic', apiKey: 'fixture-key', model: 'fixture-model', blocks: [{ index: 0, text: '原稿' }] };

function fixtureFetch(replies: { data: unknown; status?: number }[]) {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetcher = (async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    const reply = replies.shift();
    if (!reply) throw new Error('想定外の追加リクエスト');
    return Response.json(reply.data, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe('review providers', () => {
  test('OpenAIでも検索と指摘の構造化を要求し、サーバーへの保存を無効にする', () => {
    const body = buildOpenAIRequest(request.model, request.blocks);
    expect(body.store).toBe(false);
    expect(body.tools.map((tool) => tool.type)).toEqual(['web_search', 'function']);
    expect(body.input[0]?.content).toContain('[0] 原稿');
    expect(body.instructions).toContain('一次情報を特定できない主張は指摘として出さない');
  });

  test('OpenAIのfunction_callを共通形式の指摘として返す', () => {
    expect(parseOpenAIReport(openaiReport({ findings: [finding] }))).toEqual([finding]);
  });

  test('未完了・不正JSON・report欠落を成功扱いしない', () => {
    expect(parseOpenAIReport({ ...openaiReport({ findings: [] }), status: 'incomplete' })).toHaveProperty('error');
    expect(parseOpenAIReport({ status: 'completed', output: [{ type: 'function_call', name: 'report_findings', arguments: 'invalid' }] })).toHaveProperty('error');
    expect(parseOpenAIReport({ status: 'completed', output: [] })).toHaveProperty('error');
  });

  test('OpenAI経由でも一次出典がないfactを除外する', () => {
    expect(parseOpenAIReport(openaiReport({ findings: [{ ...finding, kind: 'fact' }] }))).toEqual([]);
  });

  test('OpenAIにAnthropicの認証ヘッダーを送らない', async () => {
    const { fetcher, calls } = fixtureFetch([{ data: openaiReport({ findings: [finding] }) }]);
    expect(await review({ ...request, provider: 'openai' }, fetcher)).toEqual([finding]);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]?.options.headers).toEqual({ 'content-type': 'application/json', Authorization: 'Bearer fixture-key' });
    expect(calls[0]?.options.redirect).toBe('error');
  });

  test('Anthropicのpause_turn後にassistantの検索結果を渡して継続する', async () => {
    const paused = { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', name: 'web_search' }] };
    const { fetcher, calls } = fixtureFetch([{ data: paused }, { data: anthropicReport }]);
    expect(await review(request, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(2);
    const continued = JSON.parse(calls[1]!.options.body as string);
    expect(continued.messages.at(-1)).toEqual({ role: 'assistant', content: paused.content });
  });

  test('pause_turnが続いたら有限回で終了し、途中結果を成功扱いしない', async () => {
    const { fetcher, calls } = fixtureFetch(Array.from({ length: 5 }, () => ({ data: { stop_reason: 'pause_turn', content: [] } })));
    await expect(review(request, fetcher)).rejects.toThrow('継続回数の上限');
    expect(calls).toHaveLength(5);
  });

  test('認証エラーはAPIの説明を返し、他のプロバイダーへ再送しない', async () => {
    const { fetcher, calls } = fixtureFetch([{ status: 401, data: { error: { message: '認証失敗' } } }]);
    await expect(review(request, fetcher)).rejects.toThrow('認証失敗');
    expect(calls).toHaveLength(1);
  });
});
