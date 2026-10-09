const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT),
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__health') {
      return Response.json({ ready: api.port === 18787 });
    }
    if (url.pathname === '/generic-layout') {
      const ambiguous = url.searchParams.has('ambiguous');
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
        <title>minaosi E2E generic layout</title><body>
        <style>[contenteditable] { border: 1px solid; box-sizing: border-box; }
        #draft, #second { width: 700px; height: 240px; } #small { width: 200px; height: 40px; }</style>
        <div id="draft" contenteditable="true"><p>これはE2E用の合成原稿です。</p></div>
        <div id="small" contenteditable="true">別の小さな入力欄</div>
        <div aria-label="コメント" contenteditable="true" style="width:900px;height:500px">大きなコメント欄</div>
        <button onclick="document.querySelector('#second').hidden = false">本文候補を追加</button>
        <div id="second" contenteditable="true"${ambiguous ? '' : ' hidden'}><p>もう一つの合成原稿です。</p></div>
        </body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/no-editor') {
      return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><title>閲覧画面</title><body>編集領域のない画面です。</body></html>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/auto-layout') {
      // ?autoedit=<ms> でパネル側をアクティブにしている間も本文が自分で編集される
      const autoedit = Number(url.searchParams.get('autoedit')) || 0;
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
        <title>minaosi E2E auto layout</title><body>
        <style>[contenteditable] { border: 1px solid; box-sizing: border-box; }
        #draft { width: 700px; min-height: 240px; }</style>
        <div id="draft" contenteditable="true" role="textbox" aria-label="本文" aria-multiline="true">
          <p>第一段落の合成原稿です。</p><p>第二段落の合成原稿です。</p>
        </div>
        <button id="edit-first">一段落目を書き換える</button>
        <script>
          document.getElementById('edit-first').addEventListener('click', () => {
            document.querySelector('#draft p').textContent = '書き換えた第一段落です。';
          });
          ${autoedit ? `setTimeout(() => document.getElementById('edit-first').click(), ${autoedit});` : ''}
        </script>
        </body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/note-layout') {
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
        <title>minaosi E2E note layout</title><body><div>
        <header role="navigation"><button>下書き保存</button><button>公開に進む</button></header>
        <main><textarea placeholder="記事タイトル">合成タイトル</textarea>
        <div contenteditable="true" translate="no" class="ProseMirror note-common-styles__textnote-body" role="textbox" aria-multiline="true">
        <p>これはE2E用の合成原稿です。</p></div></main>
        </div></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
      <title>minaosi E2E draft</title><body><main>
      <h1>合成原稿</h1>
      <label>タイトル<input aria-label="タイトル"></label>
      <div contenteditable="true" role="textbox" aria-label="本文"><p>これはE2E用の合成原稿です。</p></div>
      <aside aria-label="コメント"><div contenteditable="true" role="textbox" aria-label="コメント">コメントは原稿に含めません。</div></aside>
      </main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
});
console.log(`E2E site: http://127.0.0.1:${server.port}`);

/**
 * 自動校閲 E2E 用の偽校閲 API。WXT_REVIEW_API_URL=http://127.0.0.1:18787/review で
 * ビルドした拡張がここへ送る。/turnstile は widget ページの protocol だけを模倣し、
 * /__requests は送信済みリクエストの観測口。
 */
export type ReviewCall = {
  blocks: { index: number; text: string }[];
  hasToken: boolean;
};

const reviewCalls: ReviewCall[] = [];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
const api = Bun.serve({
  hostname: '127.0.0.1',
  port: 18787,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/turnstile') {
      return new Response(`<!doctype html><meta charset="utf-8"><title>stub turnstile</title>
        <script>
          const post = (event, data) => parent.postMessage({ type: 'minaosi-turnstile', event, ...data }, '*');
          post('ready');
          addEventListener('message', (e) => {
            if (e.data?.type === 'minaosi-turnstile' && e.data.event === 'execute') post('token', { token: 'e2e-fake-turnstile-token' });
          });
        </script>`, { headers: { ...CORS, 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/review' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { blocks?: { index: number; text: string }[] } | null;
      const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
      reviewCalls.push({ blocks, hasToken: request.headers.get('cf-turnstile-response') === 'e2e-fake-turnstile-token' });
      const findings = blocks
        .filter((b) => typeof b.text === 'string' && b.text.trim())
        .map((b) => ({
          kind: 'typo',
          block: b.index,
          title: `合成の指摘${b.index}`,
          reason: 'E2E用の合成の指摘です',
          matches: [{ from: b.text.slice(0, 4), to: `${b.text.slice(0, 4)}、` }],
        }))
        .filter((f) => f.matches[0]!.from.length > 0);
      return Response.json({ findings }, { headers: CORS });
    }
    if (url.pathname === '/__requests') return Response.json(reviewCalls, { headers: CORS });
    if (url.pathname === '/__reset' && request.method === 'POST') {
      reviewCalls.length = 0;
      return new Response(null, { status: 204, headers: CORS });
    }
    return new Response('not found', { status: 404, headers: CORS });
  },
});
console.log(`E2E fake review API: http://127.0.0.1:${api.port}`);
