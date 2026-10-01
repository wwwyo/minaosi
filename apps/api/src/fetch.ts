import type { HttpFetch } from './schema';

/** 認証付きの上流リクエストをリダイレクト先へ転送しない。 */
export async function fetchWithoutRedirects(fetcher: HttpFetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // 使用中のworkerdではredirect:errorが実行時に拒否されるため、手動で3xxを拒否する。
  const response = await fetcher(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('校閲APIのリダイレクトを拒否しました');
  }
  return response;
}
