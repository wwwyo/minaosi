import { describe, expect, test } from 'bun:test';
import { reviewThroughGateway } from './review';
import type { HttpFetch } from '../entrypoints/minaosi/review/providers';

const env = { CLOUDFLARE_ACCOUNT_ID: 'fixture-account', CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway', CF_AIG_TOKEN: 'fixture-cf-token' };
const finding = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '原稿', to: '修正' }] };
const request = { provider: 'anthropic' as const, model: 'claude-sonnet-5', blocks: [{ index: 0, text: '原稿' }] };

function sse(events: Record<string, unknown>[]) {
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function anthropicReport(findings: unknown[] = [finding]) {
  return sse([
    { type: 'message_start', message: { id: 'msg-fixture', type: 'message', role: 'assistant', content: [], model: request.model, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'report-fixture', name: 'report_findings', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ findings }) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]);
}
function fetchFixture(responses: Response[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input, options) => {
    calls.push({ url: String(input), headers: new Headers(options?.headers), body: JSON.parse(options?.body as string) });
    expect(options?.redirect).toBe('error');
    const response = responses.shift();
    if (!response) throw new Error('想定外の追加リクエスト');
    return response;
  }) as HttpFetch;
  return { fetcher, calls };
}

describe('TanStack AI via Cloudflare', () => {
  test('Anthropicの検索とreportをGateway経由で実行し、ログ・キャッシュを無効にする', async () => {
    const { fetcher, calls } = fetchFixture([anthropicReport()]);
    expect(await reviewThroughGateway(request, 'fixture-user-key', env, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://gateway.ai.cloudflare.com/v1/fixture-account/fixture-gateway/anthropic/v1/messages?beta=true');
    expect(call.headers.get('x-api-key')).toBe('fixture-user-key');
    expect(call.headers.get('cf-aig-authorization')).toBe('Bearer fixture-cf-token');
    expect(call.headers.get('cf-aig-skip-cache')).toBe('true');
    expect(call.headers.get('cf-aig-collect-log')).toBe('false');
    expect((call.body.tools as { name: string }[]).map((tool) => tool.name)).toEqual(['web_search', 'report_findings']);
  });

  test('OpenAIのResponses APIと検索をGatewayへ送り、キーの持ち主を切り替えない', async () => {
    const item = { id: 'fc-fixture', type: 'function_call', call_id: 'call-fixture', name: 'report_findings', arguments: JSON.stringify({ findings: [finding] }) };
    const response = { id: 'resp-fixture', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
    const { fetcher, calls } = fetchFixture([sse([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments },
      { type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: item.arguments },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ])]);
    expect(await reviewThroughGateway({ ...request, provider: 'openai', model: 'gpt-5.4-mini' }, 'fixture-openai-key', env, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://gateway.ai.cloudflare.com/v1/fixture-account/fixture-gateway/openai/responses');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer fixture-openai-key');
    expect(calls[0]!.headers.get('x-api-key')).toBeNull();
    expect(calls[0]!.body.store).toBe(false);
    expect((calls[0]!.body.tools as { type: string }[]).map((tool) => tool.type)).toEqual(['web_search', 'function']);
  });

  test('Anthropicが検索を中断した場合も検索結果を引き継いでreportまで継続する', async () => {
    const paused = sse([
      { type: 'message_start', message: { id: 'paused-fixture', type: 'message', role: 'assistant', content: [], model: request.model, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'search-fixture', name: 'web_search', input: { query: '一次情報' } } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'web_search_tool_result', tool_use_id: 'search-fixture', content: [{ type: 'web_search_result', title: '一次情報', url: 'https://example.com/source', encrypted_content: 'fixture-content', page_age: null }] } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ]);
    const { fetcher, calls } = fetchFixture([paused, anthropicReport()]);
    expect(await reviewThroughGateway(request, 'fixture-key', env, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body.messages)).toContain('fixture-content');
  });

  test('Gatewayの認証失敗を再送せず、結果がない応答を成功扱いしない', async () => {
    const { fetcher, calls } = fetchFixture([Response.json({ error: { message: 'invalid key' } }, { status: 401 })]);
    await expect(reviewThroughGateway(request, 'fixture-key', env, fetcher)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

test('検索のpause_turnが続いた場合は5回までで失敗する', async () => {
  const responses = Array.from({ length: 5 }, () => sse([
    { type: 'message_start', message: { id: 'pause-limit-fixture', type: 'message', role: 'assistant', content: [], model: request.model, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '検索中' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]));
  const { fetcher, calls } = fetchFixture(responses);
  await expect(reviewThroughGateway(request, 'fixture-key', env, fetcher)).rejects.toThrow();
  expect(calls).toHaveLength(5);
});

test('reportがない完了応答は空の成功として返さない', async () => {
  const { fetcher } = fetchFixture([sse([
    { type: 'message_start', message: { id: 'missing-report-fixture', type: 'message', role: 'assistant', content: [], model: request.model, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ])]);
  await expect(reviewThroughGateway(request, 'fixture-key', env, fetcher)).rejects.toThrow('校閲結果が返りませんでした');
});

test('壊れたツール入力は秘密を含まない診断で失敗し、検索を継続しない', async () => {
  const { fetcher, calls } = fetchFixture([sse([
    { type: 'message_start', message: { id: 'invalid-input-fixture', type: 'message', role: 'assistant', content: [], model: request.model, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'invalid-call-fixture', name: 'report_findings', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"fixture-private-key":' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ])]);
  await expect(reviewThroughGateway(request, 'fixture-key', env, fetcher)).rejects.toThrow('校閲 API が不正なツール入力を返しました');
  expect(calls).toHaveLength(1);
});
