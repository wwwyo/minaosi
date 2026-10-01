import { expect, test } from 'bun:test';
import { configureFailureMessage } from './configure-worker-errors';

test('cfの認証・権限・未作成・通信失敗を秘密のない診断にする', () => {
  for (const [stderr, expected] of [
    ['No authentication token found', '認証トークン'],
    ['Forbidden', '権限がありません'],
    ['Worker script does not exist', '先にデプロイ'],
    ['fetch failed', '接続に失敗'],
  ]) {
    const message = configureFailureMessage(`${stderr}\nfixture-private-key`, 1);
    expect(message).toContain(expected!);
    expect(message).not.toContain('fixture-private-key');
    expect(message).toContain('exit 1');
  }
  expect(configureFailureMessage('unknown fixture-private-key', 2)).not.toContain('fixture-private-key');
});
