import { validateReport, type ReviewedFinding } from './schema';
import { chat, toolDefinition } from '@tanstack/ai';
import { fetchWithoutRedirects } from './fetch';
import { OpenAIChatCompletionsTextAdapter, type createOpenaiChatCompletions } from '@tanstack/ai-openai';
import { LANGUAGE_RULES } from './rubric';
import { REPORT_TOOL, systemPrompt, userPrompt } from './prompt';
import type { HttpFetch, ProviderReviewInput } from './schema';

/** ローカルBYOKでOpenCode GoのChat Completions APIを呼ぶ。 */
export async function reviewWithOpenCode(request: ProviderReviewInput, apiKey: string, fetcher: HttpFetch = fetch): Promise<ReviewedFinding[]> {
  if (request.provider !== 'opencode-go' || request.model !== 'space-bunny-free') throw new Error('未対応のOpenCodeモデルです');
  let findings: ReviewedFinding[] | undefined;
  const schema = structuredClone(REPORT_TOOL.input_schema);
  schema.properties.findings.items.properties.kind.enum = ['typo', 'rule'];
  const report = toolDefinition({ name: REPORT_TOOL.name, description: REPORT_TOOL.description, inputSchema: schema }).server((input) => {
    const parsed = validateReport(input);
    if (!Array.isArray(parsed)) return parsed;
    // 検索なしで出された出典は、実際に確認した事実の指摘として表示しない。
    findings = parsed.filter((finding) => finding.kind !== 'fact');
    return { accepted: true };
  });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 210_000);
  let requests = 0;
  const safeFetch: HttpFetch = (input, options) => {
    if (++requests > 3) throw new Error('校閲の実行回数上限に達しました');
    return fetchWithoutRedirects(fetcher, input, options);
  };
  const adapter = new OpenAIChatCompletionsTextAdapter<Parameters<typeof createOpenaiChatCompletions>[0], { max_tokens: number }>({
    apiKey,
    baseURL: 'https://opencode.ai/zen/go/v1',
    defaultHeaders: { 'user-agent': 'minaosi/0.1.0', 'x-opencode-session': crypto.randomUUID() },
    fetch: safeFetch, maxRetries: 0, timeout: 210_000,
  }, request.model as Parameters<typeof createOpenaiChatCompletions>[0]);
  try {
    const stream = chat({
      adapter,
      messages: [{ role: 'user', content: userPrompt(request.blocks) }],
      systemPrompts: [systemPrompt(LANGUAGE_RULES, false)],
      tools: [report],
      modelOptions: { max_tokens: 8192 },
      agentLoopStrategy: ({ iterationCount }) => findings === undefined && iterationCount < 3,
      abortController,
      debug: false,
    });
    for await (const event of stream) {
      if (event.type === 'RUN_ERROR') throw new Error('OpenCode Goの校閲を完了できませんでした');
    }
    if (abortController.signal.aborted) throw new Error('校閲がタイムアウトしました');
    if (findings === undefined) throw new Error('校閲結果が返りませんでした');
    return findings;
  } finally { clearTimeout(timer); }
}
