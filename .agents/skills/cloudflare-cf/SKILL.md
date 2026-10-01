---
name: cloudflare-cf
description: "minaosiのCloudflareリソース操作・AI Gateway設定・Worker設定をcf CLIで行う。CloudflareのCLI選択やコマンド探索、cloudflare.config.tsへの移行を扱うときに使う。"
---

# minaosiでCloudflare cfを使う

Cloudflareの操作には `mise exec -- cf` を使う。これは `cloudflare/cf` のCLI。プロダクト選定とAI Gatewayの仕様は [cloudflare](../cloudflare/SKILL.md)、Workerの実装・レビューは [workers-best-practices](../workers-best-practices/SKILL.md) を読む。これらがWrangler skillを案内しても、CLI操作はこのskillとユーザー指定を優先する。

## コマンドを探す

1. `mise exec -- cf cli search "<操作とリソース種別>"` で探す。検索文にドメイン、アカウント名、ID、メール、秘密を入れない。
2. 最も合う結果のコマンドに `--help` を付け、必要な引数を確認する。rootやgroupのhelpを順に巡回しない。
3. APIの入力構造が必要なら、そのコマンドの先頭の `cf` を `cf schema` に置き換える。schemaは生成されたAPIコマンドを対象にする。
4. 変更前は対象のアカウント・Worker・環境を確認し、対応するAPIコマンドの `--dry-run` でリクエストを確認する。dry-runに認証ヘッダーや秘密が出る場合は出力を記録しない。

探索例（リソース操作は実行しない）:

```bash
mise exec -- cf cli search "list AI gateways"
mise exec -- cf cli search "upload Worker secrets in bulk"
```

結果のJSONと終了コードを確認する。削除の中断が終了コード0になることがあるため、削除完了を終了コードだけで判断しない。

## このrepoの構成と秘密

- 実ファイルを確認してから操作する。Workerは `server/worker.ts`、AI Gateway連携は `server/review.ts`、設定更新は `scripts/configure-worker.ts`。ブラウザ拡張はWXTで、Workerとはビルド経路が異なる。
- `wrangler.jsonc` だけの構成で `cf dev` / `cf build` / `cf deploy` を直接実行すると、既存設定を無視した自動設定が発生しうる。プロジェクト操作をcfへ移すタスクでは、[移行ガイド](https://developers.cloudflare.com/cf/wrangler/migrate/)を読み、`cf migrate --dry-run` で差分を確認してから `cloudflare.config.ts` へ移行する。skill導入やリソース操作だけを理由に移行しない。
- リソース操作は未移行のrepoでもcfで行える。cfはWranglerのログインや設定内のアカウントIDを引き継がないので、miseの環境変数と対象を確認する。
- 秘密はユーザー指定どおりmise + ageで管理し、必要なプロセスに注入する。キーを引数・平文設定・ログへ書かない。Workerへの設定更新は既存のstdin経路を使う。
- BYOKキーと原稿の本文ログ・キャッシュを無効化している設計を維持する。一般的なobservabilityの推奨だけでこれらを有効化しない。

## 一次資料

cfはbetaなので、インストール済みのhelpと現行の資料を確認する。

- [ドキュメント索引](https://developers.cloudflare.com/cf/llms.txt)
- [Agent向けコマンド探索・schema・dry-run](https://developers.cloudflare.com/cf/agents/)
- [Wranglerとの違いと移行条件](https://developers.cloudflare.com/cf/wrangler/)
- [開発・ビルド・デプロイ](https://developers.cloudflare.com/cf/projects/)

このskillはminaosi用に作成した手順で、Cloudflare公式配布skillではない。
