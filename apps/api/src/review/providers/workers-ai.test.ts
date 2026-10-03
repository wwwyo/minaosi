import { describe, expect, test } from 'bun:test';
import { reviewWithWorkersAi } from './workers-ai';

const finding = { kind: 'typo' as const, block: 0, title: '誤字', reason: '理由', matches: [{ from: '原稿', to: '修正' }] };
const request = { model: '@cf/deepseek-ai/deepseek-v4-flash-0731', blocks: [{ index: 0, text: '原稿' }] };

/** Workers AI binding は OpenAI 形式の Chat Completions SSE を返す。 */
function deepseekTool(name: string, input: unknown) {
  const args = JSON.stringify(input);
  const chunks = [
    { tool_calls: [{ index: 0, id: 'deepseek-report', type: 'function', function: { name, arguments: args.slice(0, 20) } }] },
    { tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] },
  ].map(delta => ({ id: 'deepseek-completion', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta, finish_reason: null }] }));
  const end = { id: 'deepseek-completion', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] };
  return new Response([...chunks, end].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

const deepseekReport = (findings: unknown[] = [finding]) => deepseekTool('report_findings', { findings });

function bindingFixture(responses: Response[]) {
  const calls: { model: string; inputs: Record<string, unknown>; options: Record<string, unknown> | undefined }[] = [];
  const AI = {
    run: async (model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) => {
      calls.push({ model, inputs, options });
      const response = responses.shift();
      if (!response) throw new Error('想定外の追加リクエスト');
      return response;
    },
  } satisfies import("../schema").AiBinding;
  return { AI, calls };
}

describe('Workers AI bindingの標準校閲', () => {
  test('プロバイダーキーなしでbindingを呼び、検索・出典取得ツールを提供する', async () => {
    const { AI, calls } = bindingFixture([deepseekReport()]);
    expect(await reviewWithWorkersAi(request, { AI })).toEqual({ findings: [finding], factCheck: { status: 'unavailable', sourceCheckedBlocks: [] } });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.model).toBe('@cf/deepseek-ai/deepseek-v4-flash-0731');
    // Gateway未設定ではgatewayオプションを送らない。
    expect(call.options?.gateway).toBeUndefined();
    expect(call.inputs.max_tokens).toBe(16_384);
    const tools = call.inputs.tools as { function: { name: string; parameters: Record<string, unknown> } }[];
    expect(tools.map(tool => tool.function.name)).toEqual(['web_search', 'read_source', 'report_findings']);
    expect(JSON.stringify(call.inputs.messages)).toContain('検索結果のタイトルや抜粋を出典として扱わない');
  });

  test('Gateway設定時はbindingのgatewayオプションでログとキャッシュ無効を伝える', async () => {
    const { AI, calls } = bindingFixture([deepseekReport()]);
    await reviewWithWorkersAi(request, { AI, REVIEW_GATEWAY_ID: 'fixture-gateway' });
    expect(calls[0]!.options?.gateway).toEqual({ id: 'fixture-gateway', collectLog: true, skipCache: true });
  });

  test('AI bindingがなければ上流を呼ばず安全に失敗する', async () => {
    await expect(reviewWithWorkersAi(request, {})).rejects.toThrow('Workers AI の binding が設定されていません');
  });

  test('規範をモデルへ送り、明示された例外の指摘を除き、次の校閲へ規範を持ち越さない', async () => {
    const styleGuide = '# 規範\n本文はですます調。\n## 例外\n- 会話部分では口語を許容する';
    const rule = { ...finding, kind: 'rule', matches: [{ from: 'そうだよ' }], exception: { rule: '会話部分では口語を許容する', reason: 'かぎ括弧内の会話' } };
    const style = { ...finding, kind: 'style' };
    const { AI, calls } = bindingFixture([deepseekReport([rule, style]), deepseekReport([style])]);
    const result = await reviewWithWorkersAi({ ...request, styleGuide, blocks: [{ index: 0, text: '「そうだよ」と答えました。原稿' }] }, { AI });
    expect(result.findings).toEqual([style]);
    expect(JSON.stringify(calls[0]!.inputs.messages)).toContain('本文はですます調');
    expect(JSON.stringify(calls[0]!.inputs.messages)).toContain('明示されていない例外を作らない');
    expect((await reviewWithWorkersAi(request, { AI })).findings).toEqual([]);
    expect(JSON.stringify(calls[1]!.inputs.messages)).not.toContain('会話部分では口語を許容する');
  });

  test('生成された出典つきの事実指摘を返さず、空のreportは成功する', async () => {
    const fact = { ...finding, kind: 'fact', source: { url: 'https://example.com/source', excerpt: '生成された出典' } };
    expect((await reviewWithWorkersAi(request, { AI: bindingFixture([deepseekReport([finding, fact])]).AI })).findings).toEqual([finding]);
    expect((await reviewWithWorkersAi(request, { AI: bindingFixture([deepseekReport([])]).AI })).findings).toEqual([]);
  });

  test('検索から取得した本文の引用があるfactだけを返す', async () => {
    const excerpt = '東京タワーの高さは333メートルです。これは試験用の一次情報です。';
    const source = { url: 'https://www.tokyotower.co.jp/height', excerpt };
    const valid = { ...finding, kind: 'fact', source };
    const invented = { ...valid, source: { ...source, excerpt: '取得したページに存在しない文章を捏造した出典です。' } };
    const { AI, calls } = bindingFixture([
      deepseekTool('web_search', { block: 0, query: '東京タワー 高さ 公式' }),
      deepseekTool('read_source', { block: 0, url: source.url }),
      deepseekReport([finding, valid, invented]),
    ]);
    const searchAI = { ...AI, websearch: async () => Response.json({ items: [{ url: source.url, title: '公式' }] }) };
    const fetcher = async () => new Response(`<html><body><p>${excerpt}</p></body></html>`, { headers: { 'content-type': 'text/html' } });
    expect(await reviewWithWorkersAi(request, { AI: searchAI, CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway' }, fetcher)).toEqual({ findings: [finding, valid], factCheck: { status: 'partial', sourceCheckedBlocks: [0] } });
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(calls[2]!.inputs.messages)).toContain(excerpt);
  });

  test('Web Search APIが利用枠超過を返しても誤字の指摘は失わない', async () => {
    const { AI } = bindingFixture([
      deepseekTool('web_search', { block: 0, query: '東京タワー 高さ' }), deepseekReport(),
    ]);
    const searchAI = { ...AI, websearch: async () => Response.json({ error: 'usage limit exceeded' }, { status: 402 }) };
    expect(await reviewWithWorkersAi(request, { AI: searchAI, CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway' })).toEqual({ findings: [finding], factCheck: { status: 'unavailable', sourceCheckedBlocks: [] } });
  });

  test('検索3回と本文取得6回を順に使っても最後に校閲結果を返す', async () => {
    const urls = Array.from({ length: 6 }, (_, index) => `https://official.example.com/source/${index}`);
    const { AI, calls } = bindingFixture([
      ...Array.from({ length: 3 }, (_, index) => deepseekTool('web_search', { block: 0, query: `東京タワー 高さ 公式 ${index}` })),
      ...urls.map(url => deepseekTool('read_source', { block: 0, url })),
      deepseekReport(),
    ]);
    let searches = 0;
    let reads = 0;
    const searchAI = { ...AI, websearch: async () => {
      const items = urls.slice(searches * 2, searches * 2 + 2).map(url => ({ url, title: '公式' }));
      searches++;
      return Response.json({ items });
    } };
    const fetcher = async () => {
      reads++;
      return new Response('<body><p>東京タワーの高さは333メートルです。試験用の一次情報です。</p></body>', { headers: { 'content-type': 'text/html' } });
    };
    expect(await reviewWithWorkersAi(request, { AI: searchAI, CLOUDFLARE_AI_GATEWAY_ID: 'fixture-gateway' }, fetcher)).toEqual({ findings: [finding], factCheck: { status: 'partial', sourceCheckedBlocks: [0] } });
    expect(calls).toHaveLength(10);
    expect(searches).toBe(3);
    expect(reads).toBe(6);
  });

  test('reportなしで終わった応答は成功にしない', async () => {
    const text = new Response('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta: { content: '完了' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    await expect(reviewWithWorkersAi(request, { AI: bindingFixture([text]).AI })).rejects.toThrow('校閲結果が返りませんでした');
  });
});
