import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('Accessモデルが設定を保存し、保存状態が再読み込み後も残る', { tags: ['model'] }, async ({ app, agent, screen, browser }) => {
  const optionsUrl = process.env.MINAOSI_E2E_OPTIONS_URL;
  if (!optionsUrl) throw new Error('The extension browser did not provide its options URL.');
  await app.open(optionsUrl);
  await expect(screen.getByRole('radio', /minaosiの標準/)).toBeChecked();
  await agent.act('「minaosiの標準」の設定を「保存する」ボタンで保存してください。保存したら完了してください。', {
    maxModelCalls: 6, maxSteps: 6,
  });
  await expect(screen.getByRole('status')).toHaveText('保存しました');
  await browser.reload();
  await expect(screen.getByRole('radio', /minaosiの標準/)).toBeChecked();
  await expect(screen.getByRole('button', '保存する')).toBeEnabled();
});

test('編集領域のない画面には起動ボタンが表示されない', { tags: ['model'] }, async ({ app, agent, browser }) => {
  await app.open('/no-editor');
  await expect(browser.locator('#minaosi-root')).not.toBeAttached();
  await agent.assert('画面右下にminaosiのm字ロゴを持つ丸い起動ボタンは表示されていない', { vision: true });
});
