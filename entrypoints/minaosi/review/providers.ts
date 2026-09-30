import { validateReport, type ReviewedFinding, type ReviewBlock } from './prompt';

export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ReviewMode = 'default' | 'byok';

export type ReviewProvider = 'anthropic' | 'openai';

export function isReviewProvider(value: unknown): value is ReviewProvider {
  return value === 'anthropic' || value === 'openai';
}

export interface ProviderReviewInput {
  provider: ReviewProvider;
  model: string;
  blocks: ReviewBlock[];
}

export type ReviewRequest = { type: 'minaosi:review' } & (
  | ({ mode?: 'byok' } & ProviderReviewInput)
  | { mode: 'default'; blocks: ReviewBlock[] }
);

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
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(request.mode === 'default' ? {} : { 'x-minaosi-api-key': apiKey }) },
    body: JSON.stringify(request.mode === 'default'
      ? { mode: 'default', blocks: request.blocks }
      : { provider: request.provider, model: request.model, blocks: request.blocks }),
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(240_000),
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
