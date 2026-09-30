# minaosi

人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張。AI は生成ではなく編集者として指摘し、採否は人間が決める。最初のターゲットは note。

## Getting Started

```bash
mise install
bun install
bun run dev
```

拡張アイコンまたはnote編集画面の右下のボタンから、ブラウザのサイドpaneを開く。pane内の「見直す」で校閲し、指摘を選ぶと原稿の対象箇所を確認できる。

設定ではAnthropicまたはOpenAIへの直接接続を選べる。API key・モデル・送信への同意は接続先ごとに保持する。OpenAIではResponses APIのweb searchに対応するモデルを指定する。日本語ルールは常時適用し、文体規範ファイルの設定は不要。
