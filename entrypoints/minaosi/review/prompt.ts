import { KIND_LABEL, type DraftBlock, type FindingKind } from '../types';
import type { LanguageRule } from '../rubric';

/** LLM が返す wire 形式。content 側の Finding への正規化は controller が行う。 */
export interface RawMatch {
  from?: string;
  to?: string;
}

/** kind は wire では任意文字列。parseReport が FindingKind に絞る */
export interface RawFinding {
  kind?: string;
  block?: number;
  title?: string;
  reason?: string;
  matches?: RawMatch[];
  source?: { url?: string; label?: string; excerpt?: string };
}

/** kind の妥当性を検証済みの RawFinding */
export type ReviewedFinding = RawFinding & { kind: FindingKind };

const FINDING_KINDS = Object.keys(KIND_LABEL) as FindingKind[];

export const REPORT_TOOL = {
  name: 'report_findings',
  description: '校閲で見つかった指摘の一覧を返す。指摘がなければ findings: [] で呼ぶ。',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'block', 'title', 'reason', 'matches'],
          properties: {
            kind: { type: 'string', enum: FINDING_KINDS },
            block: { type: 'integer', description: '入力の [n] ブロック番号' },
            title: { type: 'string', description: '指摘の短い表題' },
            reason: { type: 'string', description: '採否を判断するに足る理由' },
            matches: {
              type: 'array',
              description: '指摘が及ぶ箇所。ブロック本文中の完全一致文字列を from に入れる',
              items: {
                type: 'object',
                required: ['from'],
                properties: {
                  from: { type: 'string', description: 'ブロック本文中の完全一致する原文' },
                  to: { type: 'string', description: '修正案。修正候補を持たない指摘では省略' },
                },
              },
            },
            source: {
              type: 'object',
              description: 'fact では必須。一次情報の参照',
              required: ['url'],
              properties: {
                url: { type: 'string' },
                label: { type: 'string', description: '出典名' },
                excerpt: { type: 'string', description: '出典内の該当箇所の引用' },
              },
            },
          },
        },
      },
    },
    required: ['findings'],
  },
};

export function systemPrompt(enabledRules: LanguageRule[]): string {
  const rules = enabledRules.map((r) => `- ${r.label}: ${r.hint}`).join('\n');
  return `あなたは日本語の原稿を校閲する編集者です。文章の書き換えはせず、指摘だけを行います。結果は必ず report_findings ツール呼び出しで返してください。

# 指摘の種類
- typo: 誤字・脱字
- fact: 事実の誤り
- rule: 日本語ルールへの抵触

# 要件
- matches[].from にはブロック本文中の完全一致する文字列を入れる。同じ文字列がブロック内に複数出る場合は、指摘したい全箇所分を出現順に matches へ並べる。
- 修正案がある場合は matches[].to に入れる。修正候補のない指摘は to を省略する。
- fact は必ず web_search ツールで一次情報（公的統計・一次報告・公式発表など）を確認し、source.url に一次情報の URL、source.excerpt に根拠となる該当箇所の引用を入れる。一次情報を特定できない主張は指摘として出さない。
- 本文の無いブロック（画像・改行など）は (本文なし) と表示されている。
- 過剰な指摘は避ける。書き手が採否を判断できる理由を reason に書く。

# 日本語ルール（これらに抵触する箇所を指摘する）
${rules}`;
}

export type ReviewBlock = Pick<DraftBlock, 'index' | 'text'>;

export function userPrompt(blocks: ReviewBlock[]): string {
  const body = blocks
    .map((b) => `[${b.index}] ${b.text || '(本文なし)'}`)
    .join('\n');
  return `# 原稿（ブロック番号つき）\n${body}`;
}

/** Anthropic Messages API のリクエスト body を組み立てる */
export function buildRequest(opts: {
  model: string;
  blocks: ReviewBlock[];
  enabledRules: LanguageRule[];
}): unknown {
  return {
    model: opts.model,
    max_tokens: 8192,
    system: systemPrompt(opts.enabledRules),
    tools: [
      { type: 'web_search_20250305', name: 'web_search', max_uses: 8 },
      REPORT_TOOL,
    ],
    messages: [{ role: 'user', content: userPrompt(opts.blocks) }],
  };
}

/**
 * Messages API のレスポンスから report_findings の input を取り出し、
 * kind・block・source などの最低限の妥当性でフィルタする。
 * matches の from が本文と一致するかの判定は block 要素が要るため controller 側で行う。
 */
export function parseReport(data: unknown): ReviewedFinding[] | { error: string } {
  if (!data || typeof data !== 'object') return { error: 'API レスポンスを解釈できません' };
  const content = (data as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    const msg = (data as { error?: { message?: string } }).error?.message;
    return { error: msg ?? 'API レスポンスを解釈できません' };
  }
  const call = [...content]
    .reverse()
    .find(
      (b): b is { type: 'tool_use'; input: unknown } =>
        !!b &&
        typeof b === 'object' &&
        (b as { type?: string }).type === 'tool_use' &&
        (b as { name?: string }).name === 'report_findings',
    );
  if (!call) return { error: '校閲結果が返りませんでした' };
  return validateReport(call.input);
}

/** プロバイダーの応答形式に依存せず、指摘の必須項目と一次出典を検証する。 */
export function validateReport(input: unknown): ReviewedFinding[] | { error: string } {
  const raw = input && typeof input === 'object' ? (input as { findings?: unknown }).findings : undefined;
  if (!Array.isArray(raw)) return { error: '校閲結果の形式が不正です' };
  return raw.filter(
    (f): f is ReviewedFinding =>
      !!f &&
      typeof f === 'object' &&
      FINDING_KINDS.includes(f.kind as FindingKind) &&
      typeof f.title === 'string' &&
      typeof f.reason === 'string' &&
      Array.isArray(f.matches) &&
      // 一次出典の URL と根拠の該当箇所が無い事実の指摘は出さない（PRD の絶対条件）
      (f.kind !== 'fact' ||
        (typeof f.source?.url === 'string' &&
          /^https?:\/\//.test(f.source.url) &&
          typeof f.source.excerpt === 'string' &&
          f.source.excerpt.length > 0)),
  );
}
