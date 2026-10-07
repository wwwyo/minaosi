import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('本文の隣のヘッダーに保存操作がある執筆画面を検知する', { tags: ['surface'] }, async ({ app, browser, agent }) => {
  await app.open('/note-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
  await expect(browser.locator('textarea')).toHaveValue('合成タイトル');
  await expect(browser.locator('[contenteditable="true"]')).toHaveText('これはE2E用の合成原稿です。');
});

test('保存操作なしで大きい本文を検知し、競合した領域は手動で選べる', { tags: ['surface'] }, async ({ app, screen, browser, agent }) => {
  await app.open('/generic-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
  await screen.getByRole('button', '本文候補を追加').tap();
  await expect(browser.locator('#minaosi-root')).not.toBeAttached();
  await browser.locator('#second').tap();
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await expect(browser.locator('#draft')).toHaveText('これはE2E用の合成原稿です。');
  await expect(browser.locator('#second')).toHaveText('もう一つの合成原稿です。');
});

test('パネルで未判定・編集領域なし・確定した本文を区別する', { tags: ['surface'] }, async ({ app, screen, browser }) => {
  await app.open('/generic-layout?ambiguous');
  const draftUrl = await browser.url();
  const optionsUrl = process.env.MINAOSI_E2E_OPTIONS_URL;
  if (!optionsUrl) throw new Error('The extension browser did not provide its options URL.');
  await app.open(optionsUrl);
  // 公開のtabs APIで別タブを用意し、実際のcontent scriptへパネルを接続する。
  const tabId = await browser.evaluate<number, string>('async url => (await chrome.tabs.create({ url, active: false })).id', draftUrl);
  await app.open(optionsUrl.replace('options.html', 'sidepanel.html'));
  await browser.evaluate('async id => { await chrome.tabs.update(id, { active: true }); }', tabId);
  await expect(screen.getByText('本文かは未判定です。見直したい編集領域をクリックしてください。')).toBeVisible();
  await expect(screen.getByRole('button', '見直す')).toBeDisabled();
  await browser.evaluate('async data => { await chrome.tabs.update(data.id, { url: data.url }); }', { id: tabId, url: new URL('/no-editor', draftUrl).href });
  await expect(screen.getByText('編集領域はありません')).toBeVisible();
  await expect(screen.getByRole('button', '見直す')).not.toBeVisible();
  await browser.evaluate('async data => { await chrome.tabs.update(data.id, { url: data.url }); }', { id: tabId, url: new URL('/generic-layout', draftUrl).href });
  await expect(screen.getByRole('button', '見直す')).toBeEnabled();
  await expect(screen.getByText('本文かは未判定です。見直したい編集領域をクリックしてください。')).not.toBeVisible();
});
