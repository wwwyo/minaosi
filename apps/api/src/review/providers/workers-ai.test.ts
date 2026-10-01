import { describe, expect, test } from 'bun:test';
import { reviewWithWorkersAi } from './workers-ai';

const finding = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '原稿', to: '修正' }] };
const request = { model: '@cf/deepseek-ai/deepseek-v4-flash-0731', blocks: [{ index: 0, text: '原稿' }] };

/** Workers AI binding は OpenAI 形式の Chat Completions SSE を返す。 */
function deepseekReport(findings: unknown[] = [finding]) {
  const args = JSON.stringify({ findings });
  const chunks = [
    { tool_calls: [{ index: 0, id: 'deepseek-report', type: 'function', function: { name: 'report_findings', arguments: args.slice(0, 20) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] },
  ].map(delta => ({ id: 'deepseek-completion', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta, finish_reason: null }] }));
  const end = { id: 'deepseek-completion', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return new Response([...chunks, end].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

function bindingFixture(responses: Response[]) {
  const calls: { model: string; inputs: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
  const AI = {
    run: async (model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ model, inputs, options });
      const response = responses.shift();
      if (!response) throw new Error('想定外の追加リクエスト');
      return response;
    },
  } as unknown as import("../schema").AiBinding;
  return { AI, calls };
}

describe('Workers AI bindingの標準校閲', () => {
  test('プロバイダーキーなしでbindingを呼び、検索なしの事実指摘は許さない', async () => {
    const { AI, calls } = bindingFixture([deepseekReport()]);
    expect(await reviewWithWorkersAi(request, { AI })).toEqual([finding]);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe('@cf/deepseek-ai/deepseek-v4-flash-0731');
    // Gateway未設定ではgatewayオプションを送らない。
    expect(call.options?.gateway).toBeUndefined();
    expect(call.inputs.max_tokens).toBe(16_384);
    const tools = call.inputs.tools as { function: { name: string; parameters: Record<string, unknown> } }[];
    expect(tools.map(tool => tool.function.name)).toEqual(['report_findings']);
    expect(JSON.stringify(tools)).toContain('"enum":["typo","rule"]');
    expect(JSON.stringify(call.inputs.messages)).toContain('事実の正誤に関する指摘は出さない');
    expect(JSON.stringify(call.inputs)).not.toContain('web_search');
  });

  test('Gateway設定時はbindingのgatewayオプションでログとキャッシュ無効を伝える', async () => {
    const { AI, calls } = bindingFixture([deepseekReport()]);
    await reviewWithWorkersAi(request, { AI, REVIEW_GATEWAY_ID: 'fixture-gateway' });
    expect(calls[0]!.options?.gateway).toEqual({ id: 'fixture-gateway', collectLog: true, skipCache: true });
  });

  test('AI bindingがなければ上流を呼ばず安全に失敗する', async () => {
    await expect(reviewWithWorkersAi(request, {})).rejects.toThrow('Workers AI の binding が設定されていません');
  });

  test('生成された出典つきの事実指摘を返さず、空のreportは成功する', async () => {
    const fact = { ...finding, kind: 'fact', source: { url: 'https://example.com/source', excerpt: '生成された出典' } };
    expect(await reviewWithWorkersAi(request, { AI: bindingFixture([deepseekReport([finding, fact])]).AI })).toEqual([finding]);
    expect(await reviewWithWorkersAi(request, { AI: bindingFixture([deepseekReport([])]).AI })).toEqual([]);
  });

  test('reportなしで終わった応答は成功にしない', async () => {
    const text = new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: { content: '完了' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    await expect(reviewWithWorkersAi(request, { AI: bindingFixture([text]).AI })).rejects.toThrow('校閲結果が返りませんでした');
  });
});
