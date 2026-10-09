import { beforeEach, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { connectPanel } from './support/panel';

beforeEach(async () => {
  const response = await fetch('http://127.0.0.1:18787/__reset', { method: 'POST' });
  if (!response.ok) throw new Error('Could not reset the synthetic review requests.');
});

test('本文の隣のヘッダーに保存操作がある執筆画面を検知する', { tags: ['surface', 'model'] }, async ({ app, browser, agent }) => {
  await app.open('/note-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
  await expect(browser.locator('textarea')).toHaveValue('合成タイトル');
  await expect(browser.locator('[contenteditable="true"]')).toHaveText('これはE2E用の合成原稿です。');
});

test('保存操作なしで大きい本文を検知し、競合しても手動の起動ボタンを残す', { tags: ['surface', 'model'] }, async ({ app, screen, browser, agent }) => {
  await app.open('/generic-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
  await screen.getByRole('button', '本文候補を追加').tap();
  await expect(browser.locator('#second')).toBeVisible();
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await expect(browser.locator('#draft')).toHaveText('これはE2E用の合成原稿です。');
  await expect(browser.locator('#second')).toHaveText('もう一つの合成原稿です。');
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
});

test('パネルで未判定・編集領域なし・確定した本文を区別する', { tags: ['surface'] }, async ({ app, screen, browser }) => {
  await app.open('/generic-layout?ambiguous');
  const draftUrl = await browser.url();
  const optionsUrl = process.env.MINAOSI_E2E_OPTIONS_URL;
  if (!optionsUrl) throw new Error('The extension browser did not provide its options URL.');
  await app.open(optionsUrl);
  // 公開のtabs APIで別タブを用意し、実際のcontent scriptへパネルを接続する。
  const { tabId } = await connectPanel(app, browser, optionsUrl, draftUrl);
  await expect(screen.getByText('本文かは未判定です。最大の編集領域を見直せます。')).toBeVisible();
  await expect(screen.getByRole('button', '見直す')).toBeEnabled();
  // 未判定の本文へ自動校閲は出さない（自動校閲の状態行自体が無い）
  await expect(screen.getByText('自動校閲中')).not.toBeVisible();
  await browser.evaluate('async data => { await chrome.tabs.update(data.id, { url: data.url }); }', { id: tabId, url: new URL('/no-editor', draftUrl).href });
  await expect(screen.getByText('編集領域はありません')).toBeVisible();
  await expect(screen.getByRole('button', '見直す')).not.toBeVisible();
  await browser.evaluate('async data => { await chrome.tabs.update(data.id, { url: data.url }); }', { id: tabId, url: new URL('/generic-layout', draftUrl).href });
  // 確定した本文ではボタンを押さず自動で校閲が走り、指摘が届く
  await expect(screen.getByText('自動校閲中')).toBeVisible();
  await expect(screen.getByText('合成の指摘0')).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText('本文かは未判定です。最大の編集領域を見直せます。')).not.toBeVisible();
});
