import { hc, type InferRequestType } from 'hono/client';
import type { AppType, ReviewedFinding, ReviewProvider } from '@minaosi/api/rpc';
import { KIND_LABEL } from '../types';

const FINDING_KINDS = Object.keys(KIND_LABEL);

export type { ReviewProvider, ReviewMode } from '@minaosi/api/rpc';
export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ReviewClient = ReturnType<typeof hc<AppType>>;
export type ReviewRequest = { type: 'minaosi:review' } & InferRequestType<ReviewClient['review']['$post']>['json'];

export function isReviewProvider(value: unknown): value is ReviewProvider {
  return value === 'anthropic' || value === 'openai' || value === 'deepseek' || value === 'opencode-go';
}

/** 原稿と利用者のキーを、ビルド時に指定した校閲サーバーへ送る。 */
export async function review(
  request: ReviewRequest,
  apiKey: string,
  endpoint: string,
  fetcher: HttpFetch = fetch,
): Promise<ReviewedFinding[]> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('校閲サーバーには HTTPS が必要です');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('校閲サーバーの URL が不正です');
  if (url.pathname !== '/review') throw new Error('校閲サーバーの URL が不正です');
  const client = hc<AppType>(url.origin, {
    fetch: fetcher,
    headers: request.mode === 'default' ? {} : { 'x-minaosi-api-key': apiKey },
    init: { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(240_000) },
  });
  const response = await client.review.$post({
    json: request.mode === 'default'
      ? { mode: 'default', blocks: request.blocks }
      : { provider: request.provider, model: request.model, blocks: request.blocks },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null;
    throw new Error(typeof error === 'string' ? error : `校閲サーバーのエラー（status ${response.status}）`);
  }
  const findings = validateReport(data);
  if (!Array.isArray(findings)) throw new Error(findings.error);
  return findings;
}

/** プロバイダーの応答形式に依存せず、指摘の必須項目と一次出典を検証する。 */
export function validateReport(input: unknown): ReviewedFinding[] | { error: string } {
  const raw = input && typeof input === 'object' ? (input as { findings?: unknown }).findings : undefined;
  if (!Array.isArray(raw)) return { error: '校閲結果の形式が不正です' };
  return raw.filter(
    (f): f is ReviewedFinding =>
      !!f &&
      typeof f === 'object' &&
      FINDING_KINDS.includes(f.kind as string) &&
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
