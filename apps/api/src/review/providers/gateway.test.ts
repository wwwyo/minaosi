import { describe, expect, test } from 'bun:test';
import { reviewThroughGateway } from './gateway';
import type { HttpFetch } from '../schema';

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
function deepseekReport(findings: unknown[] = [finding]) {
  const args = JSON.stringify({ findings });
  const chunks = [
    { tool_calls: [{ index: 0, id: 'deepseek-report', type: 'function', function: { name: 'report_findings', arguments: args.slice(0, 20) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] },
  ].map(delta => ({ id: 'deepseek-completion', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: null }] }));
  const end = { id: 'deepseek-completion', object: 'chat.completion.chunk', model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return new Response([...chunks, end].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function fetchFixture(responses: Response[]) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input, options) => {
    calls.push({ url: String(input), headers: new Headers(options?.headers), body: JSON.parse(options?.body as string) });
    expect(options?.redirect).toBe('manual');
    const response = responses.shift();
    if (!response) throw new Error('想定外の追加リクエスト');
    return response;
  }) as HttpFetch;
  return { fetcher, calls };
}

describe('TanStack AI via Cloudflare', () => {
  test('DeepSeekはChat Completionsと利用者のキーで校閲し、通常endpointで実行できるtoolだけを送る', async () => {
    const { fetcher, calls } = fetchFixture([deepseekReport()]);
    expect(await reviewThroughGateway({ ...request, provider: 'deepseek', model: 'deepseek-flash' }, 'fixture-deepseek-key', env, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://gateway.ai.cloudflare.com/v1/fixture-account/fixture-gateway/deepseek/chat/completions');
    expect(call.headers.get('authorization')).toBe('Bearer fixture-deepseek-key');
    expect(call.headers.get('x-api-key')).toBeNull();
    expect(call.headers.get('cf-aig-authorization')).toBe('Bearer fixture-cf-token');
    expect(call.headers.get('cf-aig-skip-cache')).toBe('true');
    expect(call.headers.get('cf-aig-collect-log')).toBe('true');
    expect(call.headers.get('cf-aig-collect-log-payload')).toBe('false');
    expect(call.body.model).toBe('deepseek-flash');
    expect(call.body.max_tokens).toBe(8192);
    expect(call.body.thinking).toEqual({ type: 'disabled' });
    expect(call.body).not.toHaveProperty('store');
    expect(call.body).not.toHaveProperty('max_output_tokens');
    expect(call.body.tools).toEqual([{ type: 'function', function: {
      name: 'report_findings', description: expect.any(String), strict: false, parameters: expect.any(Object),
    } }]);
    expect(call.body.tools).toMatchObject([{ function: { parameters: {
      properties: { findings: { items: { properties: { kind: { enum: ['typo', 'rule'] } } } } },
    } } }]);
    expect(JSON.stringify(call.body.messages)).toContain('事実の正誤に関する指摘は出さない');
  });

  test('DeepSeekが検索なしの出典を生成しても事実指摘を返さず、空のreportは成功する', async () => {
    const fact = { ...finding, kind: 'fact', source: { url: 'https://example.com/source', excerpt: '生成された出典' } };
    const input = { ...request, provider: 'deepseek' as const, model: 'deepseek-flash' };
    expect(await reviewThroughGateway(input, 'fixture-key', env, fetchFixture([deepseekReport([finding, fact])]).fetcher)).toEqual([finding]);
    expect(await reviewThroughGateway(input, 'fixture-key', env, fetchFixture([deepseekReport([])]).fetcher)).toEqual([]);
  });

  test('DeepSeekの認証失敗を再送せず、reportのない完了を成功にしない', async () => {
    const input = { ...request, provider: 'deepseek' as const, model: 'deepseek-flash' };
    const { fetcher, calls } = fetchFixture([Response.json({ error: { message: 'fixture-private-key private-draft' } }, { status: 401 })]);
    await expect(reviewThroughGateway(input, 'fixture-key', env, fetcher)).rejects.toThrow('校閲 API が処理を完了できませんでした');
    expect(calls).toHaveLength(1);
    const text = new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: input.model, choices: [{ index: 0, delta: { content: '完了' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    await expect(reviewThroughGateway(input, 'fixture-key', env, fetchFixture([text]).fetcher)).rejects.toThrow('校閲結果が返りませんでした');
  });

  test('Anthropicの検索とreportをGateway経由で実行し、本文保存・キャッシュを無効にして使用量ログを残す', async () => {
    const { fetcher, calls } = fetchFixture([anthropicReport()]);
    expect(await reviewThroughGateway(request, 'fixture-user-key', env, fetcher)).toEqual([finding]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://gateway.ai.cloudflare.com/v1/fixture-account/fixture-gateway/anthropic/v1/messages?beta=true');
    expect(call.headers.get('x-api-key')).toBe('fixture-user-key');
    expect(call.headers.get('cf-aig-authorization')).toBe('Bearer fixture-cf-token');
    expect(call.headers.get('cf-aig-skip-cache')).toBe('true');
    expect(call.headers.get('cf-aig-collect-log')).toBe('true');
    expect(call.headers.get('cf-aig-collect-log-payload')).toBe('false');
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
    expect(calls[0]!.headers.get('cf-aig-skip-cache')).toBe('true');
    expect(calls[0]!.headers.get('cf-aig-collect-log')).toBe('true');
    expect(calls[0]!.headers.get('cf-aig-collect-log-payload')).toBe('false');
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
