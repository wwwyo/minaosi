import { LANGUAGE_RULES } from '../rubric';
import { buildRequest, REPORT_TOOL, parseReport, systemPrompt, userPrompt, validateReport, type ReviewedFinding, type ReviewBlock } from './prompt';

export type ReviewProvider = 'anthropic' | 'openai';

export interface ReviewRequest {
  type: 'minaosi:review';
  provider: ReviewProvider;
  apiKey: string;
  model: string;
  blocks: ReviewBlock[];
}

const MAX_CONTINUATIONS = 4;

export function buildOpenAIRequest(model: string, blocks: ReviewBlock[]) {
  return {
    model,
    store: false,
    max_output_tokens: 8192,
    instructions: systemPrompt(LANGUAGE_RULES),
    input: [{ role: 'user', content: userPrompt(blocks) }],
    tools: [
      { type: 'web_search' },
      { type: 'function', name: REPORT_TOOL.name, description: REPORT_TOOL.description, parameters: REPORT_TOOL.input_schema, strict: false },
    ],
  };
}

export function parseOpenAIReport(data: unknown) {
  if (!data || typeof data !== 'object') return { error: 'API レスポンスを解釈できません' };
  const response = data as { status?: string; output?: unknown };
  if (response.status !== 'completed') return { error: '校閲結果が完了しませんでした' };
  if (!Array.isArray(response.output)) return { error: 'API レスポンスを解釈できません' };
  const call = [...response.output].reverse().find((item) =>
    item?.type === 'function_call' && item.name === REPORT_TOOL.name);
  if (!call || typeof call.arguments !== 'string') return { error: '校閲結果が返りませんでした' };
  try {
    return validateReport(JSON.parse(call.arguments));
  } catch {
    return { error: '校閲結果の形式が不正です' };
  }
}

/** 一次情報の検索と校閲を行い、共通形式の指摘だけを返す。 */
export async function review(request: ReviewRequest, fetcher: typeof fetch = fetch): Promise<ReviewedFinding[]> {
  const anthropic = request.provider === 'anthropic';
  if (!anthropic && request.provider !== 'openai') throw new Error('未対応の接続先です');
  const endpoint = anthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/responses';
  const headers: Record<string, string> = anthropic
    ? { 'content-type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : { 'content-type': 'application/json', Authorization: `Bearer ${request.apiKey}` };
  const body: Record<string, unknown> = anthropic
    ? buildRequest({ model: request.model, blocks: request.blocks, enabledRules: LANGUAGE_RULES }) as Record<string, unknown>
    : buildOpenAIRequest(request.model, request.blocks);
  let messages = body.messages as unknown[] | undefined;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await fetcher(endpoint, {
      method: 'POST', headers, redirect: 'error',
      body: JSON.stringify(anthropic ? { ...body, messages } : body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message ?? `API エラー（status ${response.status}）`);
    if (anthropic && data?.stop_reason === 'pause_turn' && Array.isArray(data.content)) {
      messages = [...(messages ?? []), { role: 'assistant', content: data.content }];
      continue;
    }
    const findings = anthropic ? parseReport(data) : parseOpenAIReport(data);
    if (!Array.isArray(findings)) throw new Error(findings.error);
    return findings;
  }
  throw new Error('校閲が継続回数の上限に達しました。もう一度「見直す」で確認してください');
}
