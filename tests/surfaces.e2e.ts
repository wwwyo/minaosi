import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('本文の隣のヘッダーに保存操作がある執筆画面を検知する', { tags: ['surface'] }, async ({ app, browser, agent }) => {
  await app.open('/note-layout');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
  await expect(browser.locator('textarea')).toHaveValue('合成タイトル');
  await expect(browser.locator('[contenteditable="true"]')).toHaveText('これはE2E用の合成原稿です。');
});
