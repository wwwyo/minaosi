/** CLIの出力を固定した診断へ変換し、秘密を含み得る原文は表示しない。 */
export function configureFailureMessage(stderr: string, exitCode: number): string {
  let reason = 'cf の認証・権限と Worker の存在を確認してください';
  if (/No authentication token found|Authentication error|Invalid API Token/i.test(stderr)) {
    reason = 'cf の認証トークンが未設定または無効です';
  } else if (/Forbidden|insufficient permissions|permission denied/i.test(stderr)) {
    reason = 'Worker の設定を更新する権限がありません';
  } else if (/script.*not found|worker.*not found|script.*does not exist/i.test(stderr)) {
    reason = 'Worker が見つかりません。先にデプロイしてください';
  } else if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(stderr)) {
    reason = 'Cloudflare への接続に失敗しました';
  }
  return `Worker の設定に失敗しました（cf exit ${exitCode}）。${reason}`;
}
