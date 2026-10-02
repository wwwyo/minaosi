import { describe, expect, test } from 'bun:test';
import { parseSearchResults, searchDuckDuckGo } from './duckduckgo';
import { createFactSearch } from './tools';
import { fetchPage, pageText, publicUrl } from './web';

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const url = 'https://official.example.com/source';
const results = () => html(`<a class="result__a" href="${url}">一次情報</a>`);
const blocks = [{ index: 0, text: '東京タワーは高さが100メートルだと書かれた試験用の原稿です。' }];

describe('DuckDuckGo検索', () => {
  test('ラップされたリンクを復元し、広告・重複・内部URLを除外する', async () => {
    const markup = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}">公式 &amp; 一次情報</a>
      <a class="result__a" href="${url}">重複</a>
      <a class="result__a" href="https://localhost/source">内部</a>
      <a class="result__a" href="//duckduckgo.com/l/?ad_domain=example.com&amp;uddg=${encodeURIComponent(url + '/ad')}">広告</a>`;
    expect(await parseSearchResults(markup)).toEqual([{ url, title: '公式 & 一次情報' }]);
  });

  test('送信するのは検索語と地域で、結果は最大3件に抑える', async () => {
    const result = await searchDuckDuckGo('東京タワー 高さ 公式', async (input, init) => {
      expect(String(input)).toBe('https://html.duckduckgo.com/html/');
      expect(new URLSearchParams(init?.body as string).get('q')).toBe('東京タワー 高さ 公式');
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('manual');
      return html(Array.from({ length: 5 }, (_, i) => `<a class="result__a" href="${url}/${i}">公式</a>`).join(''));
    });
    expect(result).toHaveLength(3);
  });

  test('challenge・アクセス制限・形式変更は未確認にする', async () => {
    for (const response of [html('<form id="challenge-form"></form>', 202), html('blocked', 429), html('<p>結果なし</p>')]) {
      await expect(searchDuckDuckGo('検索語', async () => response)).rejects.toThrow();
    }
  });
});

describe('出典取得', () => {
  test('本文からスクリプト・ナビゲーションを除き、HTMLエンティティを解釈する', async () => {
    expect(await pageText('<html><body><nav>メニュー</nav><p>東京 &amp; タワー</p><script>秘密</script><p>高さ333メートル</p></body></html>')).toBe('東京 & タワー 高さ333メートル');
  });

  test('brや自己終了するsvgがあっても本文を取得できる', async () => {
    expect(await pageText('<body><svg/><p>段落1<br>段落2</p></body>')).toBe('段落1 段落2');
  });

  test('内部アドレスや認証URLを拒否し、リダイレクト先にも同じ制限をかける', async () => {
    for (const input of ['http://example.com', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://localhost', 'https://localhost.', 'https://server.local', 'https://server.local.', 'https://user:pass@example.com', 'https://example.com:8443']) {
      expect(() => publicUrl(input)).toThrow();
    }
    let calls = 0;
    await expect(fetchPage(url, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } }); })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('サイズ偽装やPDFを本文として取り込まない', async () => {
    await expect(fetchPage(url, async () => html('x'.repeat(524_289)))).rejects.toThrow('大きすぎ');
    await expect(fetchPage(url, async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } }))).rejects.toThrow('本文形式');
  });
});

describe('事実の指摘と取得した出典の照合', () => {
  test('原稿全文や未知の段落を検索へ送らず、任意URLも取得しない', async () => {
    let calls = 0;
    const search = createFactSearch(blocks, async () => { calls++; return results(); });
    await search.tools[0]!.execute!({ block: 0, query: blocks[0]!.text });
    await search.tools[0]!.execute!({ block: 9, query: '東京タワー' });
    await search.tools[1]!.execute!({ block: 0, url });
    expect(calls).toBe(0);
    expect(search.summary()).toEqual({ status: 'unavailable', sourceCheckedBlocks: [] });
  });

  test('長い段落の逐語抜粋や検索語に混ぜた原稿の一節を外部送信しない', async () => {
    const text = '東京タワーの高さについて書き手が考えた公開前の文章です。'.repeat(10);
    let calls = 0;
    const search = createFactSearch([{ index: 0, text }], async () => { calls++; return results(); });
    await search.tools[0]!.execute!({ block: 0, query: text.slice(0, 160) });
    await search.tools[0]!.execute!({ block: 0, query: `公式 ${text.slice(0, 25)} 高さ` });
    expect(calls).toBe(0);
    await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
    expect(calls).toBe(1);
  });

  test('検索だけの抜粋や捏造引用を除外し、取得した引用のみを認める', async () => {
    const excerpt = '東京タワーの高さは333メートルです。試験用の一次情報です。';
    const search = createFactSearch(blocks, async input => String(input).includes('duckduckgo.com') ? results() : html(`<body><p>${excerpt}</p></body>`));
    const finding = { kind: 'fact' as const, block: 0, title: '高さ', reason: '理由', matches: [{ from: '100メートル' }], source: { url, excerpt } };
    await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
    expect(search.verified([finding])).toEqual([]);
    await search.tools[1]!.execute!({ block: 0, url });
    expect(search.verified([finding])).toEqual([finding]);
    expect(search.verified([{ ...finding, source: { url, excerpt: '取得したページに存在しない引用を捏造した文章です。' } }])).toEqual([]);
    expect(search.summary()).toEqual({ status: 'partial', sourceCheckedBlocks: [0] });
  });

  test('検索回数は校閲ごとに制限され、次の原稿へ持ち越さない', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return results(); };
    const search = createFactSearch(blocks, fetcher);
    for (let i = 0; i < 5; i++) await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(3);
    const next = createFactSearch(blocks, fetcher);
    await next.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(4);
  });
});
