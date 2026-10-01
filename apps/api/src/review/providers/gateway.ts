import { validateReport, type ReviewedFinding } from '../schema';
import { chat, toolDefinition } from '@tanstack/ai';
import { fetchWithoutRedirects } from './fetch';
import { anthropicAdapter, INVALID_TOOL_INPUT } from './anthropic';
import { webSearchTool as anthropicSearch } from '@tanstack/ai-anthropic/tools';
import { createOpenaiChat, OpenAIChatCompletionsTextAdapter, type createOpenaiChatCompletions } from '@tanstack/ai-openai';
import { webSearchTool as openaiSearch } from '@tanstack/ai-openai/tools';
import { cloudflareGateway } from '@tanstack/ai-cloudflare';
import { LANGUAGE_RULES } from '../rubric';
import { REPORT_TOOL, systemPrompt, userPrompt } from '../prompt';
import type { HttpFetch, ProviderReviewInput } from '../schema';

export interface GatewayEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
}

/** TanStack AI の校閲を、利用者のキーで Gateway の provider-native 経路へ送る。 */
export async function reviewThroughGateway(
  request: ProviderReviewInput,
  apiKey: string,
  env: GatewayEnv,
  fetcher: HttpFetch = fetch,
): Promise<ReviewedFinding[]> {
  if (request.provider === 'opencode-go') throw new Error('OpenCode GoはローカルBYOK経路で実行してください');
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_GATEWAY_ID || !env.CF_AIG_TOKEN) throw new Error('Gatewayの接続設定がありません');
  const gateway = cloudflareGateway(request.provider, {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
    cfApiKey: env.CF_AIG_TOKEN,
    skipCache: true,
    collectLog: true,
  });
  const factChecking = request.provider !== 'deepseek';
  const reportSchema = structuredClone(REPORT_TOOL.input_schema);
  if (!factChecking) reportSchema.properties.findings.items.properties.kind.enum = ['typo', 'rule'];
  let findings: ReviewedFinding[] | undefined;
  let reportError: string | undefined;
  const report = toolDefinition({
    name: REPORT_TOOL.name,
    description: REPORT_TOOL.description,
    inputSchema: reportSchema,
  }).server((input) => {
    const parsed = validateReport(input);
    if (!Array.isArray(parsed)) {
      reportError = parsed.error;
      return { error: parsed.error };
    }
    // 出典URLを生成しても、検索を実行していない指摘は確認済みと扱わない。
    findings = factChecking ? parsed : parsed.filter(finding => finding.kind !== 'fact');
    return { accepted: true };
  });
  let requests = 0;
  const safeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (++requests > 5) throw new Error('校閲の実行回数上限に達しました');
    if (request.provider === 'deepseek' && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      // TanStackはstrict=trueを付けるが、DeepSeekの通常endpointはBeta strictを使わない。
      body.tools = [{ type: 'function', function: {
        name: REPORT_TOOL.name, description: REPORT_TOOL.description, parameters: reportSchema, strict: false,
      } }];
      init = { ...init, body: JSON.stringify(body) };
    }
    return fetchWithoutRedirects(fetcher, input, init);
  };
  const config = {
    baseURL: gateway.baseURL,
    // collectLog=false では使用量も消えるため、本文の保存だけを抑制する。
    defaultHeaders: { ...gateway.headers, 'cf-aig-collect-log-payload': 'false' },
    fetch: safeFetch,
    maxRetries: 0,
    timeout: 210_000,
  };
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 210_000);
  const common = {
    messages: [{ role: 'user' as const, content: userPrompt(request.blocks) }],
    systemPrompts: [systemPrompt(LANGUAGE_RULES, factChecking)],
    abortController,
    agentLoopStrategy: ({ iterationCount }: { iterationCount: number }) => findings === undefined && iterationCount < 5,
    debug: false as const,
  };
  try {
    let stream;
    if (request.provider === 'anthropic') {
      const adapter = anthropicAdapter(request.model, apiKey, config, safeFetch);
      stream = chat({
        ...common,
        adapter,
        tools: [anthropicSearch({ name: 'web_search', type: 'web_search_20250305', max_uses: 8 }), report],
        modelOptions: { max_tokens: 8192 },
      });
    } else if (request.provider === 'deepseek') {
      const adapter = new OpenAIChatCompletionsTextAdapter<Parameters<typeof createOpenaiChatCompletions>[0], {
        max_tokens: number; thinking: { type: 'disabled' };
      }>({ apiKey, ...config }, request.model as Parameters<typeof createOpenaiChatCompletions>[0]);
      // thinkingの既定値は有効。推論履歴の再送が必要になるため、校閲は非thinkingで実行する。
      stream = chat({ ...common, adapter, tools: [report], modelOptions: { max_tokens: 8192, thinking: { type: 'disabled' } } });
    } else {
      const adapter = createOpenaiChat(request.model as Parameters<typeof createOpenaiChat>[0], apiKey, config);
      stream = chat({ ...common, adapter, tools: [openaiSearch({ type: 'web_search' }), report], modelOptions: { store: false, max_output_tokens: 8192 } });
    }
    for await (const event of stream) {
      if (event.type === 'RUN_ERROR') throw new Error(event.message === INVALID_TOOL_INPUT ? INVALID_TOOL_INPUT : '校閲 API が処理を完了できませんでした');
    }
    if (abortController.signal.aborted) throw new Error('校閲がタイムアウトしました');
    if (findings === undefined) throw new Error(reportError ?? '校閲結果が返りませんでした');
    return findings;
  } finally {
    clearTimeout(timeout);
  }
}
