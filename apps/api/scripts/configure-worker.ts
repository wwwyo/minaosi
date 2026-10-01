import { configureFailureMessage } from './configure-worker-errors';

const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_GATEWAY_ID', 'CF_AIG_TOKEN', 'ALLOWED_ORIGINS'] as const;
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`mise の環境変数が必要です: ${missing.join(', ')}`);
const standard = ['DEFAULT_REVIEW_PROVIDER', 'DEFAULT_REVIEW_MODEL', 'DEFAULT_REVIEW_API_KEY'] as const;
if (standard.some((name) => process.env[name]) && standard.some((name) => !process.env[name])) {
  throw new Error(`標準モードには3つの環境変数が必要です: ${standard.join(', ')}`);
}
const secrets = Object.fromEntries(
  [...required, ...standard.filter((name) => process.env[name])].map((name) => [name, { type: 'secret_text', text: process.env[name] }]),
);
// 秘密をプロセス引数や一時ファイルに置かず、mise の環境から stdin で渡す。
const result = Bun.spawn(['cf', 'workers', 'secrets', 'bulk', '--worker', 'minaosi-review', '--file', '/dev/stdin'], {
  stdin: new Blob([JSON.stringify(secrets)]), stdout: 'ignore', stderr: 'pipe',
});
const [exitCode, stderr] = await Promise.all([result.exited, new Response(result.stderr).text()]);
if (exitCode !== 0) throw new Error(configureFailureMessage(stderr, exitCode));
console.log('Worker の接続設定を更新しました');
