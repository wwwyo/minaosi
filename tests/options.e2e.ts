import { beforeEach, describe, test } from '@e2e-dev/web';
import { expect, secrets } from 'e2e';

describe('拡張の設定', { tags: ['options'] }, () => {
  beforeEach(async ({ app, screen }) => {
    const optionsUrl = process.env.MINAOSI_E2E_OPTIONS_URL;
    if (!optionsUrl) throw new Error('The extension browser did not provide its options URL.');
    await app.open(optionsUrl);
    await expect(screen.getByRole('heading', 'minaosi')).toBeVisible();
    await expect(screen.getByRole('button', '保存する')).toBeEnabled();
  });

  test('BYOK設定を保存し、再読み込み後も入力し直さず保存できる', async ({ screen, browser }) => {
    await screen.getByRole('radio', /自分のAPIキー/).tap();
    await expect(screen.getByRole('radio', /自分のAPIキー/)).toBeChecked();
    await screen.getByLabel('モデル').fill('gpt-5.4-mini');
    await screen.getByLabel('APIキー').fill(secrets.get('byok-test-key'));

    await screen.getByRole('button', '保存する').tap();
    await expect(screen.getByRole('status')).toHaveText('保存しました');
    await browser.reload();
    await expect(screen.getByRole('radio', /自分のAPIキー/)).toBeChecked();
    await expect(screen.getByLabel('モデル')).toHaveValue('gpt-5.4-mini');
    await expect(screen.getByRole('button', '保存する')).toBeEnabled();
    await screen.getByRole('button', '保存する').tap();
    await expect(screen.getByRole('status')).toHaveText('保存しました');
  });

  test('校閲ルールを設定せず標準モードを保存できる', async ({ screen, browser }) => {
    await expect(screen.getByRole('radio', /minaosiの標準/)).toBeChecked();
    await expect(screen.getByText('文体規範', { exact: true })).not.toBeVisible();
    await expect(browser.locator('input[type="file"]')).toHaveCount(0);
    await screen.getByRole('button', '保存する').tap();
    await expect(screen.getByRole('status')).toHaveText('保存しました');
    await browser.reload();
    await expect(screen.getByRole('radio', /minaosiの標準/)).toBeChecked();
    await expect(screen.getByRole('button', '保存する')).toBeEnabled();
    await expect(browser.locator('input[type="file"]')).toHaveCount(0);
  });
});

test('執筆画面に実際の拡張の起動ボタンが現れる', { tags: ['surface', 'model'] }, async ({ app, screen, browser, agent }) => {
  await app.open('/');
  await expect(screen.getByRole('textbox', '本文')).toHaveText('これはE2E用の合成原稿です。');
  // content scriptのisolated world内のclosed shadow rootはrunnerのDOM readerから参照できない。
  await expect(browser.locator('#minaosi-root')).toBeAttached();
  await agent.assert('画面右下に、丸い枠で囲まれたminaosiのm字のロゴの起動ボタンが表示されている', { vision: true });
});
