import type { HttpFetch } from '../schema';
import { boundedText, publicUrl } from './web';

export interface SearchResult { url: string; title: string }

/** Tavilyの結果から、重複を除いた公開HTTPSの参照先を最大3件取り出す。 */
export function parseSearchResults(input: unknown): SearchResult[] {
  if (!input || typeof input !== 'object' || !('results' in input) || !Array.isArray(input.results)) {
    throw new Error('検索結果の形式が不正です');
  }
  const results: SearchResult[] = [];
  for (const item of input.results) {
    if (!item || typeof item.url !== 'string' || typeof item.title !== 'string' || item.url.length > 2048) continue;
    try {
      const url = publicUrl(item.url).href;
      if (!results.some(result => result.url === url)) results.push({ url, title: item.title.slice(0, 300) });
    } catch { /* 公開HTTPS以外を出典候補に含めない。 */ }
    if (results.length === 3) break;
  }
  if (!results.length) throw new Error('検索結果がありません');
  return results;
}

/** 運営者のキーでBasic Searchを呼び、検索語と認証情報の転送先を固定する。 */
export async function searchTavily(query: string, apiKey: string | undefined, fetcher: HttpFetch = fetch): Promise<SearchResult[]> {
  if (!apiKey?.trim()) throw new Error('検索の接続設定がありません');
  const response = await fetcher('https://api.tavily.com/search', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query, search_depth: 'basic', topic: 'general', max_results: 3,
      auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false,
    }),
    redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(12_000),
  });
  // 認証情報を別のホストへ送らず、上流のエラー本文もモデルやログへ渡さない。
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw new Error('検索できませんでした');
  }
  return parseSearchResults(JSON.parse(await boundedText(response)));
}
