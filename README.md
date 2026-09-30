# minaosi

人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張。AI は生成ではなく編集者として指摘し、採否は人間が決める。最初のターゲットは note。

## Getting Started

```bash
mise install
bun install
bun run dev
```

拡張アイコンまたはnote編集画面の右下のボタンから、ブラウザのサイドpaneを開く。pane内の「見直す」で校閲し、指摘を選ぶと原稿の対象箇所を確認できる。

既定はminaosiの標準モード。自分のキーを使う場合は、拡張機能メニューの「オプション」で「自分のAPIキー」を選び、キーとモデルを登録して保存する。ログインは不要。原稿はminaosiの校閲サーバーでTanStack AIが処理し、Cloudflare AI Gatewayを経由して選んだプロバイダーへ送る。日本語ルールは常時適用する。

校閲サーバーも起動する必要がある。接続設定・秘密の管理・Workerのビルド手順は[校閲Gatewayの設定](docs/review-gateway.md)を参照。
