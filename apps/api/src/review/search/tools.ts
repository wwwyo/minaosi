import { toolDefinition } from '@tanstack/ai';
import type { FactCheckSummary, HttpFetch, ReviewBlock, ReviewedFinding } from '../schema';
import { searchDuckDuckGo } from './duckduckgo';
import { fetchPage, normalizeText, pageText, publicUrl } from './web';

/** 取得済みの出典だけを採用するため、検索と本文の記録を校閲リクエスト内に閉じる。 */
export function createFactSearch(blocks: ReviewBlock[], fetcher: HttpFetch = fetch) {
  const candidates = new Map<number, Set<string>>();
  const sources = new Map<string, { url: string; text: string }>();
  const checked = new Set<number>();
  let searches = 0;
  let reads = 0;
  const blockExists = (index: number) => blocks.some(block => block.index === index && block.text.trim());
  const webSearch = toolDefinition({
    name: 'web_search',
    description: '指定したブロックの主張を照合する検索語でDuckDuckGoを検索する。原稿全文や文章のコピーは送らず、必要な語句に絞る。最大3回。検索結果の抜粋は出典に使えない。',
    inputSchema: { type: 'object', required: ['block', 'query'], properties: { block: { type: 'integer' }, query: { type: 'string', maxLength: 160 } } },
  }).server(async (args) => {
    const input = args as { block?: unknown; query?: unknown } | null;
    if (!input || typeof input.block !== 'number' || !blockExists(input.block) || typeof input.query !== 'string') return { error: '検索対象が不正です' };
    const query = input.query.trim();
    if (!query || query.length > 160 || /[\r\n]/.test(query) ||
        query === blocks.map(block => block.text).join('\n').trim() ||
        blocks.some(block => block.text.trim().length >= 20 && query.includes(block.text.trim()))) {
      return { error: '原稿をコピーせず、照合に必要な短い検索語を指定してください' };
    }
    if (searches++ >= 3) return { error: '検索回数の上限です。未確認の主張は指摘しないでください' };
    try {
      const results = await searchDuckDuckGo(query, fetcher);
      const urls = candidates.get(input.block) ?? new Set<string>();
      for (const result of results) urls.add(result.url);
      candidates.set(input.block, urls);
      return { results };
    } catch {
      return { error: '検索できませんでした。誤字・日本語ルールの校閲は続け、未確認の主張は指摘しないでください' };
    }
  });
  const readSource = toolDefinition({
    name: 'read_source',
    description: 'web_searchで得た一次情報のページ本文を読む。本文に存在する引用だけを事実の指摘のsource.excerptに使う。最大6回。PDFなど本文を取得できない出典は指摘の根拠にしない。',
    inputSchema: { type: 'object', required: ['block', 'url'], properties: { block: { type: 'integer' }, url: { type: 'string', maxLength: 2048 } } },
  }).server(async (args) => {
    const input = args as { block?: unknown; url?: unknown } | null;
    if (!input || typeof input.block !== 'number' || typeof input.url !== 'string' || input.url.length > 2048 || !candidates.get(input.block)?.has(input.url)) return { error: '検索結果にあるURLを指定してください' };
    const cached = sources.get(input.url);
    if (cached) { checked.add(input.block); candidates.get(input.block)!.add(cached.url); return cached; }
    if (reads++ >= 6) return { error: '出典取得の上限です。未確認の主張は指摘しないでください' };
    try {
      const page = await fetchPage(input.url, fetcher);
      const text = /^text\/plain/i.test(page.contentType) ? normalizeText(page.text).slice(0, 24_000) : await pageText(page.text);
      if (!text) return { error: '出典本文を取得できませんでした' };
      const source = { url: page.url, text };
      sources.set(input.url, source);
      sources.set(page.url, source);
      candidates.get(input.block)!.add(page.url);
      checked.add(input.block);
      return source;
    } catch {
      return { error: '出典本文を取得できませんでした。未確認の主張は指摘しないでください' };
    }
  });
  return {
    tools: [webSearch, readSource],
    verified(findings: ReviewedFinding[]) {
      return findings.filter(finding => {
        if (finding.kind !== 'fact') return true;
        try {
          const url = publicUrl(finding.source!.url!).href;
          const source = sources.get(url);
          const excerpt = normalizeText(finding.source!.excerpt!);
          return typeof finding.block === 'number' && checked.has(finding.block) &&
            !!source && candidates.get(finding.block)?.has(url) && excerpt.length >= 20 &&
            excerpt.length <= 2000 && source.text.includes(excerpt);
        } catch { return false; }
      });
    },
    summary(): FactCheckSummary {
      return { status: checked.size ? 'partial' : 'unavailable', sourceCheckedBlocks: [...checked].sort((a, b) => a - b) };
    },
  };
}
