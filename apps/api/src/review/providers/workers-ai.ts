import { validateReport, type AiBinding, type ReviewBlock, type ReviewedFinding } from '../schema';
import { chat, toolDefinition } from '@tanstack/ai';
import { createCloudflareText, type CloudflareBindingConfig } from '@tanstack/ai-cloudflare';
import { LANGUAGE_RULES } from '../rubric';
import { REPORT_TOOL, systemPrompt, userPrompt } from '../prompt';

export interface WorkersAiEnv {
  AI?: AiBinding;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
}

export interface WorkersAiReviewInput {
  model: string;
  blocks: ReviewBlock[];
}

/** 標準校閲を Workers AI の binding で実行する。利用者・運営者のプロバイダーキーは使わない。 */
export async function reviewWithWorkersAi(request: WorkersAiReviewInput, env: WorkersAiEnv): Promise<ReviewedFinding[]> {
  if (!env.AI) throw new Error('Workers AI の binding が設定されていません');
  const schema = structuredClone(REPORT_TOOL.input_schema);
  // Workers AIに組み込み検索はなく、検索していない事実指摘は結果に含めない。
  schema.properties.findings.items.properties.kind.enum = ['typo', 'rule'];
  let findings: ReviewedFinding[] | undefined;
  let reportError: string | undefined;
  const report = toolDefinition({ name: REPORT_TOOL.name, description: REPORT_TOOL.description, inputSchema: schema }).server((input) => {
    const parsed = validateReport(input);
    if (!Array.isArray(parsed)) {
      reportError = parsed.error;
      return { error: parsed.error };
    }
    findings = parsed.filter((finding) => finding.kind !== 'fact');
    return { accepted: true };
  });
  const adapter = createCloudflareText(request.model, {
    // 構造型の AiBinding と SDK が参照する @cloudflare/workers-types の Ai は別名義の型だが、実行時の振る舞いは同じ。
    binding: env.AI as unknown as CloudflareBindingConfig['binding'],
    // binding経路ではリクエスト単位の本文ログ抑制（cf-aig-collect-log-payload）は送れない。
    // payload保存の抑制はGateway側の設定で担保する。Gateway未設定でも標準校閲は動く。
    gateway: env.CLOUDFLARE_AI_GATEWAY_ID
      ? { id: env.CLOUDFLARE_AI_GATEWAY_ID, collectLog: true, skipCache: true }
      : undefined,
  });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), 210_000);
  try {
    const stream = chat({
      adapter,
      messages: [{ role: 'user', content: userPrompt(request.blocks) }],
      systemPrompts: [systemPrompt(LANGUAGE_RULES, false)],
      tools: [report],
      // deepseek-v4-flashのreasoning既定はhigh。reasoning_contentも出力枠を消費するため余裕を持たせる。
      modelOptions: { max_tokens: 16_384 },
      agentLoopStrategy: ({ iterationCount }) => findings === undefined && iterationCount < 5,
      abortController,
      debug: false,
    });
    for await (const event of stream) {
      if (event.type === 'RUN_ERROR') throw new Error('校閲 API が処理を完了できませんでした');
    }
    if (abortController.signal.aborted) throw new Error('校閲がタイムアウトしました');
    if (findings === undefined) throw new Error(reportError ?? '校閲結果が返りませんでした');
    return findings;
  } finally {
    clearTimeout(timer);
  }
}
