import type { AiBinding } from '../schema';
import { boundedText, normalizeText, publicUrl } from './web';

export interface SearchResult { url: string; title: string }

/** Web Search APIの結果から、重複を除いた公開HTTPSの参照先を最大3件取り出す。 */
export function parseSearchResults(input: unknown): SearchResult[] {
  if (!input || typeof input !== 'object' || !('items' in input) || !Array.isArray(input.items)) {
    throw new Error('検索結果の形式が不正です');
  }
  const results: SearchResult[] = [];
  for (const item of input.items) {
    if (!item || typeof item.url !== 'string' || typeof item.title !== 'string' || item.url.length > 2048) continue;
    try {
      const url = publicUrl(item.url).href;
      if (!results.some(result => result.url === url)) results.push({ url, title: normalizeText(item.title).slice(0, 300) });
    } catch { /* 公開HTTPS以外を出典候補に含めない。 */ }
    if (results.length === 3) break;
  }
  if (!results.length) throw new Error('検索結果がありません');
  return results;
}

/** AI bindingからCeramic.aiを検索し、受信量と呼び出し側の待機を制限する。 */
export async function searchGateway(query: string, AI: Pick<AiBinding, 'websearch'> | undefined, gatewayId: string | undefined): Promise<SearchResult[]> {
  const id = gatewayId?.trim();
  if (!AI?.websearch || !id) throw new Error('検索の接続設定がありません');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('検索がタイムアウトしました'));
    }, 12_000);
  });
  const search = async () => {
    const response = await AI.websearch!({ gatewayId: id, query, provider: 'ceramic', limit: 3 });
    // bindingはAbortSignalを受け取らないため、遅れて届いた本文も破棄する。
    if (controller.signal.aborted || response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new Error('検索できませんでした');
    }
    return parseSearchResults(JSON.parse(await boundedText(response, controller.signal)));
  };
  try { return await Promise.race([search(), timeout]); }
  finally { clearTimeout(timer); }
}
