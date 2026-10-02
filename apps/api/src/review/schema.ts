export const FINDING_KINDS = ['typo', 'fact', 'rule'] as const;
export type FindingKind = typeof FINDING_KINDS[number];
export type { ReviewBlock, ReviewMode, ReviewProvider, ProviderReviewInput, ReviewInput } from './input';
export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** env.AI の最小形。Workers固有の Ai 型を拡張側の型チェックへ持ち込まないため構造的に定義する。 */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** LLM が返す wire 形式。content 側の Finding への正規化は controller が行う。 */
export interface RawMatch {
  from?: string;
  to?: string;
}

/** kind は wire では任意文字列。validateReport が FindingKind に絞る */
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

export interface FactCheckSummary {
  status: 'partial' | 'unavailable';
  /** 参照先の本文を取得したブロック。原稿全体や主張の正しさの確認を意味しない。 */
  sourceCheckedBlocks: number[];
}

export interface ReviewResult {
  findings: ReviewedFinding[];
  factCheck?: FactCheckSummary;
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
