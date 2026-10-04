import { describe, expect, test } from 'bun:test';
import { parseSearchResults, searchGateway } from './gateway';
import { createFactSearch } from './tools';
import { fetchPage, pageText, publicUrl } from './web';

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const url = 'https://official.example.com/source';
const results = () => Response.json({ items: [{ url, title: '一次情報' }] });
const blocks = [{ index: 0, text: '東京タワーは高さが100メートルだと書かれた試験用の原稿です。' }];

describe('Web Search API検索', () => {
  test('重複・内部URL・不正な結果を除き、最大3件の参照先だけを返す', () => {
    expect(parseSearchResults({ items: [
      { url, title: '  一次情報\n ', description: '抜粋'.repeat(4000) }, { url: url + '#section', title: '重複' },
      { url: 'https://localhost/source', title: '内部' }, null, { url: 1, title: '不正' },
      ...Array.from({ length: 5 }, (_, i) => ({ url: `${url}/${i}`, title: '公式' })),
    ] })).toEqual([{ url, title: '一次情報' }, { url: url + '/0', title: '公式' }, { url: url + '/1', title: '公式' }]);
  });

  test('検索語だけをAI bindingへ送り、Ceramicと最大3件を明示する', async () => {
    await searchGateway('東京タワー 高さ 公式', { websearch: async options => {
      expect(options).toEqual({ gatewayId: 'fixture-gateway', query: '東京タワー 高さ 公式', provider: 'ceramic', limit: 3 });
      return results();
    } }, ' fixture-gateway\n');
  });

  test('binding・Gateway未設定では通信せず、認証失敗・利用枠超過・リダイレクトの詳細を漏らさない', async () => {
    let calls = 0;
    const AI = { websearch: async () => { calls++; return results(); } };
    await expect(searchGateway('検索語', AI, undefined)).rejects.toThrow('接続設定');
    await expect(searchGateway('検索語', undefined, 'fixture-gateway')).rejects.toThrow('接続設定');
    await expect(searchGateway('検索語', {}, 'fixture-gateway')).rejects.toThrow('接続設定');
    expect(calls).toBe(0);
    for (const status of [302, 400, 401, 402, 429, 500]) {
      let requests = 0;
      await expect(searchGateway('検索語', { websearch: async () => {
        requests++;
        return new Response('private-upstream-details', { status, headers: { location: 'https://elsewhere.example.com', 'content-type': 'application/json' } });
      } }, 'fixture-gateway')).rejects.toThrow('検索できませんでした');
      expect(requests).toBe(1);
    }
    await expect(searchGateway('検索語', { websearch: async () => { throw new Error('binding failure'); } }, 'fixture-gateway')).rejects.toThrow();
  });

  test('非JSON・不正なJSON・形式変更・空の結果・サイズ偽装を未確認にする', async () => {
    for (const response of [html('challenge'), Response.json({ items: [] }), Response.json({ items: 'changed' }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response('x'.repeat(524_289), { headers: { 'content-type': 'application/json' } })]) {
      await expect(searchGateway('検索語', { websearch: async () => response }, 'fixture-gateway')).rejects.toThrow();
    }
  });

  test('応答待ちと本文受信を12秒で打ち切り、遅着・受信中の本文を破棄する', async () => {
    let resolveResponse!: (response: Response) => void;
    let lateCancelled = false;
    let bodyCancelled = false;
    const late = searchGateway('検索語', { websearch: () => new Promise(resolve => { resolveResponse = resolve; }) }, 'fixture-gateway');
    const stalled = searchGateway('検索語', { websearch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"items":[')); },
      cancel() { bodyCancelled = true; },
    }), { headers: { 'content-type': 'application/json' } }) }, 'fixture-gateway');
    const outcomes = await Promise.allSettled([late, stalled]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') expect(outcome.reason.message).toContain('タイムアウト');
    }
    expect(bodyCancelled).toBe(true);
    resolveResponse(new Response(new ReadableStream({ cancel() { lateCancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(lateCancelled).toBe(true);
  }, 15_000);
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
    const search = createFactSearch(blocks, { gatewayId: 'fixture-gateway', AI: { websearch: async () => { calls++; return results(); } } });
    await search.tools[0]!.execute!({ block: 0, query: blocks[0]!.text });
    await search.tools[0]!.execute!({ block: 9, query: '東京タワー' });
    await search.tools[1]!.execute!({ block: 0, url });
    expect(calls).toBe(0);
    expect(search.summary()).toEqual({ status: 'unavailable', sourceCheckedBlocks: [] });
  });

  test('長い段落の逐語抜粋や検索語に混ぜた原稿の一節を外部送信しない', async () => {
    const text = '東京タワーの高さについて書き手が考えた公開前の文章です。'.repeat(10);
    let calls = 0;
    const search = createFactSearch([{ index: 0, text }], { gatewayId: 'fixture-gateway', AI: { websearch: async () => { calls++; return results(); } } });
    await search.tools[0]!.execute!({ block: 0, query: text.slice(0, 160) });
    await search.tools[0]!.execute!({ block: 0, query: `公式 ${text.slice(0, 25)} 高さ` });
    expect(calls).toBe(0);
    await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ 公式' });
    expect(calls).toBe(1);
  });

  test('検索だけの抜粋や捏造引用を除外し、取得した引用のみを認める', async () => {
    const excerpt = '東京タワーの高さは333メートルです。試験用の一次情報です。';
    const search = createFactSearch(blocks, { gatewayId: 'fixture-gateway', AI: { websearch: async () => results() }, fetcher: async (input, init) => {
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      return html(`<body><p>${excerpt}</p></body>`);
    } });
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
    const search = createFactSearch(blocks, { gatewayId: 'fixture-gateway', AI: { websearch: fetcher } });
    for (let i = 0; i < 5; i++) await search.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(3);
    const next = createFactSearch(blocks, { gatewayId: 'fixture-gateway', AI: { websearch: fetcher } });
    await next.tools[0]!.execute!({ block: 0, query: '東京タワー 高さ' });
    expect(calls).toBe(4);
  });


});
