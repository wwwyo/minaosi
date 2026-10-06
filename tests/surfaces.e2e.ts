import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('本文の隣のヘッダーに保存操作がある執筆画面を検知する', { tags: ['surface'] }, async ({ app, browser }) => {
  await app.open('/note-layout');
  await expect(browser.locator('textarea')).toHaveValue('合成タイトル');
  await expect(browser.locator('[contenteditable="true"]')).toHaveText('これはE2E用の合成原稿です。');
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await expect(browser.locator('textarea')).toHaveValue('合成タイトル');
  await expect(browser.locator('[contenteditable="true"]')).toHaveText('これはE2E用の合成原稿です。');
});
