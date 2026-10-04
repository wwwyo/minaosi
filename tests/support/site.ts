const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT),
  fetch() {
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
