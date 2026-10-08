import { beforeEach, test, type Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectPanel } from './support/panel';
import type { ReviewCall } from './support/site';

/**
 * 自動校閲の E2E。拡張は tests/support/site.ts の偽校閲API（127.0.0.1:18787）へ向けた
 * development ビルド（bun run build:e2e）。実 AI・実 Turnstile は対象外。
 */
const REVIEW_API = 'http://127.0.0.1:18787';

beforeEach(async () => {
  const response = await fetch(`${REVIEW_API}/__reset`, { method: 'POST' });
  if (!response.ok) throw new Error('Could not reset the synthetic review requests.');
});

/** 偽校閲APIに届いた送信一覧を読む（送信側は拡張、こちらは現在のページから観測するだけ）。 */
function reviewCalls(browser: Browser): Promise<ReviewCall[]> {
  return browser.evaluate<ReviewCall[], string>(
    'async url => (await fetch(`${url}/__requests`)).json()',
    REVIEW_API,
  );
}

test('本文を開くと自動で校閲され、編集の停止で変わった段落だけを再送する', { tags: ['auto-review', 'model'] }, async ({ app, browser, agent }) => {
  await app.open('/auto-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();

  // パネルを開かなくても、起動直後に全文（2ブロック）が確認トークン付きで送られる
  await expect.poll(async () => (await reviewCalls(browser)).length, { timeout: 30_000 }).toBe(1);
  const first = (await reviewCalls(browser))[0]!;
  expect(first.blocks.map((b) => b.index)).toEqual([0, 1]);
  expect(first.hasToken).toBe(true);

  // 一段落だけ書き換えると、そのブロックだけが再送される
  await browser.locator('#edit-first').click();
  await expect.poll(async () => (await reviewCalls(browser)).length, { timeout: 30_000 }).toBe(2);
  const second = (await reviewCalls(browser))[1]!;
  expect(second.blocks.map((b) => b.index)).toEqual([0]);
  expect(second.blocks[0]!.text).toBe('書き換えた第一段落です。');

  // FAB はロゴ＋外周リングのまま（通知バッジや件数表示はない）
  await agent.assert('画面右下に丸いボタンがあり、中央にminaosiのm字ロゴ、その外周に円形のリングが見える', { vision: true });
});

test('パネルから自動校閲を一時停止・再開できる。止めている間は送信しない', { tags: ['auto-review'] }, async ({ app, browser, screen }) => {
  const optionsUrl = process.env.MINAOSI_E2E_OPTIONS_URL;
  if (!optionsUrl) throw new Error('The extension browser did not provide its options URL.');

  // サイトのURL（portは実行ごと）を知るため一度本文を開き、パネル接続用に別タブで開き直す
  await app.open('/auto-layout');
  const draftUrl = (await browser.url()).replace('/auto-layout', '/auto-layout?autoedit=20000');
  await app.open(optionsUrl);
  // ここまでに先の本文タブ（1枚目）が送った回数だけ先に数えておく
  const before = (await reviewCalls(browser)).length;
  const { tabId, openedAt } = await connectPanel(app, browser, optionsUrl, draftUrl);

  // 接続先は確定した本文なので、自動校閲の状態行が出て、開き直した本文の初期送信も届く
  await expect(screen.getByText('自動校閲中')).toBeVisible();
  await expect.poll(async () => (await reviewCalls(browser)).length, { timeout: 30_000 }).toBe(before + 1);
  const base = before + 1;

  // 一時停止：このあと本文は20秒の自己編集（autoedit）で変わるが、送信はされない
  await screen.getByRole('button', '一時停止').tap();
  await expect(screen.getByText('自動校閲は一時停止中')).toBeVisible();
  // 編集（本文タブを開いてから20秒後）+ デバウンス + 最小間隔を過ぎても送信が無いことを見る
  // — セットアップが速く終わっても、抑制された送信の最早発生時刻を窓が覆うよう本文の時計で待つ
  await sleep(Math.max(0, openedAt + 32_000 - Date.now()));
  expect((await reviewCalls(browser)).length).toBe(base);

  // 再開：溜まっていた差分が変わった段落だけ送られる
  await screen.getByRole('button', '再開').tap();
  await expect(screen.getByText('自動校閲中')).toBeVisible();
  await expect.poll(async () => (await reviewCalls(browser)).length, { timeout: 30_000 }).toBe(base + 1);
  const sent = (await reviewCalls(browser)).at(-1)!;
  expect(sent.blocks.map((b) => b.index)).toEqual([0]);
  expect(sent.blocks[0]!.text).toBe('書き換えた第一段落です。');
  await browser.evaluate('async id => { await chrome.tabs.remove(id); }', tabId);
});
