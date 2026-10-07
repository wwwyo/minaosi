const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT),
  fetch(request) {
    const url = new URL(request.url);
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
