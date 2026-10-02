import type { HttpFetch } from '../schema';
import { decodeHTML } from 'entities';
import { fetchPage, normalizeText, publicUrl } from './web';

export interface SearchResult { url: string; title: string }

/** DuckDuckGoのHTML結果から広告を除き、公開HTTPSの参照先を取り出す。 */
export async function parseSearchResults(html: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let active: SearchResult | undefined;
  const rewriter = new HTMLRewriter().on('a.result__a', {
    element(element) {
      active = undefined;
      const href = element.getAttribute('href');
      if (!href) return;
      try {
        let url = new URL(decodeHTML(href), 'https://html.duckduckgo.com');
        if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
          const destination = url.searchParams.get('uddg');
          if (!destination || url.searchParams.has('ad_domain')) return;
          url = new URL(destination);
        }
        const target = publicUrl(url.href).href;
        if (results.some(result => result.url === target) || results.length >= 3) return;
        active = { url: target, title: '' };
        results.push(active);
      } catch { /* 検索結果内の不正なURLは取得しない。 */ }
      element.onEndTag(() => { active = undefined; });
    },
    text(chunk) { if (active) active.title += chunk.text; },
  });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return results.map(result => ({ ...result, title: normalizeText(decodeHTML(result.title)) }));
}

/** 検索語のみを送信する。challengeや結果形式の変更を空の成功結果にしない。 */
export async function searchDuckDuckGo(query: string, fetcher: HttpFetch = fetch): Promise<SearchResult[]> {
  const page = await fetchPage('https://html.duckduckgo.com/html/', fetcher, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query, kl: 'jp-jp' }).toString(),
  });
  if (/anomaly\.js|anomaly-modal|challenge-form/i.test(page.text)) throw new Error('検索を取得できません');
  const results = await parseSearchResults(page.text);
  if (!results.length) throw new Error('検索結果を取得できません');
  return results;
}
