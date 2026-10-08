# プレビュー URL を Access 保護前提で有効に戻す [#31](https://github.com/wwwyo/minaosi/pull/31) を merge。Store submit は8日目も未着手

- Status: Accepted
- Date: 2026-10-06

本番の公開入口は custom domain に絞る方針で、Turnstile の hostname 管理を増やさないため workersDev と previewUrls を両方無効化していたが、プレビュー環境での校閲検証には preview URL が必要だった。無保護で開く案は採らず、previews 専用の Access application「minaosi-review previews」（Cloudflare アカウントメンバーのみ許可）を前提に `previewUrls: true` を config 側で宣言的に固定し、本番デプロイのたびに無効へ戻るのを防ぐ。残課題として、拡張は `credentials: 'omit'` で API を呼ぶためブラウザで Access にログインするだけでは preview 経由の `/review` を呼べず、Turnstile hostname の追加と Access 認証の伝搬が必要になる（前提は [docs/review-gateway.md](../review-gateway.md) に記録）

