# E2E

実行・実装・失敗調査は共通の `e2e` skill に従う。E2E はローカルで実行する。

接続環境で `CF_AI_ACCESS_URL`（Access で保護した HTTPS `/compat/chat/completions` URL）と `E2E_MODEL`（Gateway の provider/model 完全 ID）を設定し、Access にログインしてから実行する。モデルには画像認識・JSON schema 出力・tool calling が必要である。接続先と provider credential は環境側で用意し、E2E client に provider key を渡さない。

```sh
mise exec -- bun run check:e2e:model
mise exec -- bun run test:e2e
```

## 検証範囲

ビルドした実 Chromium 拡張を専用 profile にロードし、合成執筆画面で検証する。UI 操作と画像判定には実モデルを使うが、拡張の校閲 API と Turnstile は偽物である。対象要件は [設定](../docs/prd/note-inline-review/prd.md)、[surface 検知](../docs/prd/multi-surface/research.md)、[自動校閲](../docs/prd/auto-review/prd.md) に対応する。

実校閲の品質、実 Turnstile、外部サービスの認証済み編集画面、ブラウザ chrome からの side pane 開閉、Firefox は検証しない。`test:e2e:offline` はモデル不要部分だけを確認するため、実モデル E2E の成功とは区別する。

現在 head の結果・検証範囲・失敗と制限は PR に記録する。公開前に `check:e2e:artifacts` で秘密を検査し、画像の内容は目視でも確認する。
