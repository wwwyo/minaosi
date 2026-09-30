const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID', 'CF_AIG_TOKEN'] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`mise の環境変数が必要です: ${missing.join(', ')}`);
const secrets = Object.fromEntries(
  [...required, 'ALLOWED_ORIGINS'].filter((name) => process.env[name]).map((name) => [name, { type: 'secret_text', text: process.env[name] }]),
);
// 秘密をプロセス引数や一時ファイルに置かず、mise の環境から stdin で渡す。
const result = Bun.spawn(['cf', 'workers', 'secrets', 'bulk', '--worker', 'minaosi-review', '--file', '/dev/stdin'], {
  stdin: new Blob([JSON.stringify(secrets)]), stdout: 'ignore', stderr: 'ignore',
});
if (await result.exited !== 0) throw new Error('Worker の設定に失敗しました。cf の認証と Worker の存在を確認してください');
console.log('Worker の接続設定を更新しました');
