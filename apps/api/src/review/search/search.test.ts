import { describe, expect, test } from 'bun:test';
import { parseSearchResults, searchTavily } from './tavily';
import { createFactSearch } from './tools';
import { fetchPage, pageText, publicUrl } from './web';

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const url = 'https://official.example.com/source';
const results = () => Response.json({ results: [{ url, title: '一次情報' }] });
const blocks = [{ index: 0, text: '東京タワーは高さが100メートルだと書かれた試験用の原稿です。' }];

describe('Tavily検索', () => {
  test('重複・内部URL・不正な結果を除き、最大3件の参照先だけを返す', () => {
    expect(parseSearchResults({ results: [
      { url, title: '一次情報', content: '抜粋' }, { url: url + '#section', title: '重複' },
      { url: 'https://localhost/source', title: '内部' }, null, { url: 1, title: '不正' },
      ...Array.from({ length: 5 }, (_, i) => ({ url: `${url}/${i}`, title: '公式' })),
    ] })).toEqual([{ url, title: '一次情報' }, { url: url + '/0', title: '公式' }, { url: url + '/1', title: '公式' }]);
  });

  test('Basicの検索語だけを固定APIへ送り、回答生成・自動Advanced・本文抽出を使わない', async () => {
    await searchTavily('東京タワー 高さ 公式', 'fixture-key', async (input, init) => {
      expect(String(input)).toBe('https://api.tavily.com/search');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-key');
      expect(JSON.parse(init?.body as string)).toEqual({
        query: '東京タワー 高さ 公式', search_depth: 'basic', topic: 'general', max_results: 3,
        auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false,
      });
      expect(init?.credentials).toBe('omit');
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return results();
    });
  });

  test('キー未設定では通信せず、認証失敗・利用枠超過・リダイレクトの詳細を漏らさない', async () => {
    let calls = 0;
    await expect(searchTavily('検索語', undefined, async () => { calls++; return results(); })).rejects.toThrow('接続設定');
    expect(calls).toBe(0);
    for (const status of [302, 401, 429, 432, 433, 500]) {
      let requests = 0;
      await expect(searchTavily('検索語', 'fixture-key', async () => {
        requests++;
        return new Response('private-upstream-details', { status, headers: { location: 'https://elsewhere.example.com', 'content-type': 'application/json' } });
      })).rejects.toThrow('検索できませんでした');
      expect(requests).toBe(1);
    }
  });

  test('非JSON・不正なJSON・形式変更・空の結果・サイズ偽装を未確認にする', async () => {
    for (const response of [html('challenge'), Response.json({ results: [] }), Response.json({ results: 'changed' }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response('x'.repeat(524_289), { headers: { 'content-type': 'application/json' } })]) {
      await expect(searchTavily('検索語', 'fixture-key', async () => response)).rejects.toThrow();
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
    const search = createFactSearch(blocks, 'fixture-key', async () => { calls++; return results(); });
    await search.tools[0]!.execute!({ block: 0, query: blocks[0]!.text });
    await search.tools[0]!.execute!({ block: 9, query: '東京タワー' });
    await search.tools[1]!.execute!({ block: 0, url });
    expect(calls).toBe(0);
    expect(search.summary()).toEqual({ status: 'unavailable', sourceCheckedBlocks: [] });
  });

  test('長い段落の逐語抜粋や検索語に混ぜた原稿の一節を外部送信しない', async () => {
    const text = '東京タワーの高さについて書き手が考えた公開前の文章です。'.repeat(10);
    let calls = 0;
    const search = createFactSearch([{ index: 0, text }], 'fixture-key', async () => { calls++; return results(); });
    await search.tools[0]!.execute!({ block: 0, query: text.slice(0, 160) });
    await search.tools[0]!.execute!({ block: 0, query: `公式 ${text.slice(0, 25)} 高さ` });
    expect(calls).toBe(0);
    await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
    expect(calls).toBe(1);
  });

  test('検索だけの抜粋や捏造引用を除外し、取得した引用のみを認める', async () => {
    const excerpt = '東京タワーの高さは333メートルです。試験用の一次情報です。';
    const search = createFactSearch(blocks, 'fixture-key', async (input, init) => {
      if (String(input).includes('api.tavily.com')) return results();
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return html(`<body><p>${excerpt}</p></body>`);
    });
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
    const search = createFactSearch(blocks, 'fixture-key', fetcher);
    for (let i = 0; i < 5; i++) await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(3);
    const next = createFactSearch(blocks, 'fixture-key', fetcher);
    await next.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(4);
  });

  test('文体規範の全文や一節を検索語として外部へ送らない', async () => {
    const styleGuide = '書き手が自分のために用意した公開しない文体の規範を適用する。';
    let calls = 0;
    const search = createFactSearch(blocks, 'fixture-key', async () => { calls++; return results(); }, styleGuide);
    await search.tools[0]!.execute!({ block: 0, query: styleGuide });
    await search.tools[0]!.execute!({ block: 0, query: `公式 ${styleGuide.slice(0, 25)}` });
    expect(calls).toBe(0);
    await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
    expect(calls).toBe(1);
  });

  test('20文字未満の規範文や箇条書きを検索語に混ぜても外部へ送らない', async () => {
    for (const styleGuide of ['本文はですます調。', '# 文体規範\n- 本文はですます調。\n- 会話は口語を許容']) {
      let calls = 0;
      const search = createFactSearch(blocks, 'fixture-key', async () => { calls++; return results(); }, styleGuide);
      await search.tools[0]!.execute!({ block: 0, query: '公式 本文はですます調 文体' });
      expect(calls).toBe(0);
      await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
      expect(calls).toBe(1);
    }
  });

  test('Markdownで装飾した短い規範文も検索へ送らず、記号を含む原文も保護する', async () => {
    for (const styleGuide of ['- **本文はですます調。**', '- _本文はですます調。_', '- `本文はですます調。`', '- ~~本文はですます調。~~']) {
      let calls = 0;
      const search = createFactSearch(blocks, 'fixture-key', async () => { calls++; return results(); }, styleGuide);
      await search.tools[0]!.execute!({ block: 0, query: '公式 本文はですます調 文体' });
      expect(calls).toBe(0);
      await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
      expect(calls).toBe(1);
    }
    let calls = 0;
    const search = createFactSearch(blocks, 'fixture-key', async () => { calls++; return results(); }, '- my_ruleを優先');
    await search.tools[0]!.execute!({ block: 0, query: '公式 my_ruleを優先' });
    expect(calls).toBe(0);
  });
});
