import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserProvider } from '@e2e-dev/web';
import { chromium, type BrowserContext } from 'playwright';

/** Chromiumの拡張をテストごとの専用profileで起動し、runnerの終了処理で破棄する。 */
export function extensionBrowser(): BrowserProvider {
  const contexts = new Map<string, BrowserContext>();
  return {
    name: 'minaosi-local-extension',
    scope: 'attempt',
    async acquire(request) {
      const profile = await mkdtemp(join(tmpdir(), 'minaosi-e2e-'));
      let context: BrowserContext | undefined;
      try {
        const extension = resolve('apps/extension/.output/chrome-mv3');
        context = await chromium.launchPersistentContext(profile, {
          channel: 'chromium',
          headless: true,
          handleSIGINT: false,
          handleSIGTERM: false,
          // ブラウザへモデルのAPIキーやage復号キーを継承しない。
          env: { PATH: request.env.PATH ?? '', HOME: request.env.HOME ?? '' },
          args: [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
            '--remote-debugging-port=0',
          ],
        });
        request.signal.throwIfAborted();
        const worker = context.serviceWorkers()[0]
          ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
        const extensionId = new URL(worker.url()).hostname;
        // この受け渡しはe2e.config.tsのworkers: 1を前提とする。
        process.env.MINAOSI_E2E_OPTIONS_URL = `chrome-extension://${extensionId}/options.html`;
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(process.env.MINAOSI_E2E_OPTIONS_URL);
        request.signal.throwIfAborted();
        const [port] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
        if (!/^\d+$/.test(port!)) throw new Error('Chromium did not expose a valid CDP port.');
        contexts.set(profile, context);
        request.log('Loaded minaosi in an isolated Chromium profile.');
        const endpoint = `http://127.0.0.1:${port}`;
        return { id: profile, cdpEndpoint: endpoint };
      } catch (error) {
        try {
          await context?.close();
        } finally {
          await rm(profile, { recursive: true, force: true });
          delete process.env.MINAOSI_E2E_OPTIONS_URL;
        }
        throw error;
      }
    },
    async release(lease, request) {
      const context = contexts.get(lease.id);
      if (!context) throw new Error('The extension browser lease is not owned by this provider.');
      try {
        await context.close();
      } finally {
        await rm(lease.id, { recursive: true, force: true });
        delete process.env.MINAOSI_E2E_OPTIONS_URL;
        contexts.delete(lease.id);
      }
      request.log('Closed Chromium and removed the test profile.');
    },
  };
}
