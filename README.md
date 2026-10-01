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

標準モデルはDeepSeek V4.1 Flash（`deepseek-flash`）。DeepSeekでは誤字・日本語表現を校閲し、Web検索を使った事実確認は行わない。Claude / GPTのBYOKでは、従来どおり検索と一次情報の出典付きで事実の指摘も返す。標準モードの利用には運営者によるGatewayとsecretの設定が必要。

## 構成

Bun workspacesで、`apps/extension`（WXT拡張）と`apps/api`（Hono / Cloudflare Worker）を管理する。各appの依存・型チェック・ビルド設定を分け、rootのコマンドから起動できる。

拡張はHonoの`hc<AppType>`でAPIを呼ぶ。APIの`@minaosi/api/rpc`を型だけ参照し、独立した共有パッケージは持たない。プロンプト・日本語ルール・AIのtool定義はAPI内に置く。APIの実装やAI SDKを拡張の実行時バンドルへ含めない。

拡張の成果物は`apps/extension/.output/`。Workerの設定は`apps/api/cloudflare.config.ts`、入口は`apps/api/src/index.ts`。APIの開発・ビルドはcfからCloudflare Vite pluginへ委譲し、Wranglerは使わない。

APIのコードは役割ごとに分けている。

```text
apps/api/src/
├── index.ts           # Cloudflare Workerの入口
├── rpc.ts             # 拡張に公開するHono RPCの型
├── http/              # HTTPルート、入力検証、応答・実行ログ
├── review/            # 校閲の型、プロンプト、日本語ルール
│   └── providers/     # モデル呼び出しと上流HTTP通信
└── durable-objects/   # 状態を持つDOクラス（校閲の同時実行枠）
```

モデル呼び出しを追う場合は `review/providers/gateway.ts` または `review/providers/opencode.ts` を読む。HTTPから呼び出す箇所は `http/app.ts`。

校閲入力は `review/input.ts` のZodスキーマを正本にし、`http/app.ts` の `zValidator` で検証する。入力の型もスキーマから推論し、Hono RPCで拡張へ伝える。
