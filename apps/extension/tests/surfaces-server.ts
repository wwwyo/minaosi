const bundle = await Bun.build({
  entrypoints: [`${import.meta.dir}/surfaces.browser.ts`],
  target: 'browser',
  format: 'esm',
});
if (!bundle.success) throw new Error(bundle.logs.map(log => log.message).join('\n'));

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === '/tests.js') return new Response(bundle.outputs[0]);
    return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>minaosi surface checks</title>
      <body><pre id="result">検証中</pre><script type="module">
      import { runSurfaceChecks } from '/tests.js';
      try {
        window.surfaceResults = await runSurfaceChecks();
        document.getElementById('result').textContent = JSON.stringify(window.surfaceResults, null, 2);
      } catch (error) {
        window.surfaceResults = { error: String(error) };
        document.getElementById('result').textContent = String(error);
      }
      </script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
});
console.log(`Surface checks: http://127.0.0.1:${server.port}`);
