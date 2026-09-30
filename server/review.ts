import { chat, toolDefinition } from '@tanstack/ai';
import { anthropicAdapter, INVALID_TOOL_INPUT } from './anthropic';
import { webSearchTool as anthropicSearch } from '@tanstack/ai-anthropic/tools';
import { createOpenaiChat } from '@tanstack/ai-openai';
import { webSearchTool as openaiSearch } from '@tanstack/ai-openai/tools';
import { cloudflareGateway } from '@tanstack/ai-cloudflare';
import { LANGUAGE_RULES } from '../entrypoints/minaosi/rubric';
import { REPORT_TOOL, systemPrompt, userPrompt, validateReport, type ReviewedFinding } from '../entrypoints/minaosi/review/prompt';
import type { HttpFetch, ProviderReviewInput } from '../entrypoints/minaosi/review/providers';

export interface GatewayEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_AI_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
}

/** TanStack AI の校閲を、利用者のキーで Gateway の provider-native 経路へ送る。 */
export async function reviewThroughGateway(
  request: ProviderReviewInput,
  apiKey: string,
  env: GatewayEnv,
  fetcher: HttpFetch = fetch,
): Promise<ReviewedFinding[]> {
  if (request.provider === 'opencode-go') throw new Error('OpenCode GoはローカルBYOK経路で実行してください');
  const gateway = cloudflareGateway(request.provider, {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    gatewayId: env.CLOUDFLARE_AI_GATEWAY_ID,
    cfApiKey: env.CF_AIG_TOKEN,
    skipCache: true,
    collectLog: false,
  });
  let findings: ReviewedFinding[] | undefined;
  let reportError: string | undefined;
  const report = toolDefinition({
    name: REPORT_TOOL.name,
    description: REPORT_TOOL.description,
    inputSchema: REPORT_TOOL.input_schema,
  }).server((input) => {
    const parsed = validateReport(input);
    if (!Array.isArray(parsed)) {
      reportError = parsed.error;
      return { error: parsed.error };
    }
    findings = parsed;
    return { accepted: true };
  });
  let requests = 0;
  const safeFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (++requests > 5) throw new Error('校閲の実行回数上限に達しました');
    return fetcher(input, { ...init, redirect: 'error' });
  };
  const config = { baseURL: gateway.baseURL, defaultHeaders: gateway.headers, fetch: safeFetch, maxRetries: 0, timeout: 210_000 };
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 210_000);
  const common = {
    messages: [{ role: 'user' as const, content: userPrompt(request.blocks) }],
    systemPrompts: [systemPrompt(LANGUAGE_RULES)],
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
