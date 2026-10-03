# minaosi

人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張。AI は生成ではなく編集者として指摘し、採否は人間が決める。最初のターゲットは note。

## Getting Started

```bash
mise install
bun install
bun run dev
```

拡張アイコンまたはnote編集画面の右下のボタンから、ブラウザのサイドpaneを開く。pane内の「見直す」で校閲し、指摘を選ぶと原稿の対象箇所を確認できる。

既定はminaosiの標準モード。利用者のログイン・APIキー・プロバイダー契約は不要で、校閲サーバーの Workers AI binding が TanStack AI 経由で推論を実行する。自分のキーを使う場合は、拡張機能メニューの「オプション」で「自分のAPIキー」を選び、キーとモデルを登録して保存する。BYOKの原稿はCloudflare AI Gatewayを経由して選んだプロバイダーへ送る。日本語ルールは常時適用する。

校閲サーバーも起動する必要がある。接続設定・秘密の管理・Workerのビルド手順は[校閲サーバーの設定](docs/review-gateway.md)を参照。

標準モデルはCloudflareのWorkers AI上のDeepSeek V4 Flash（`@cf/deepseek-ai/deepseek-v4-flash-0731`）。標準モードは、誤字・日本語表現の校閲に加えて、AI GatewayのWeb Search API（Ceramic.ai）で一次情報を探して事実を照合する。既存のAI bindingと運営者のGatewayを使うため、利用者による検索キーの用意は不要。検索には原稿全文・文体規範・校閲結果を送らず、照合に必要な短い検索語だけを送る。取得した参照先の本文に引用が存在する事実の指摘だけを返し、検索や出典取得に失敗しても他の校閲は続ける。

1回の校閲で検索は最大3回、参照先の取得は最大6回。Ceramic.aiは$0.25／1,000検索（最大3回で$0.00075／校閲、推論料金は別）。Gatewayに同プロバイダーの`default`キーがあればそのキーを使い、なければAI Gatewayクレジットで支払う。クレジットの購入や自動補充はこのアプリから行わない。HTMLとプレーンテキストを取得でき、PDF・アクセス制限・取得上限を超える本文は未確認とする。[公式のプロバイダー一覧](https://developers.cloudflare.com/web-search/providers/)ではCeramic.aiはZero Data Retention対応とされている。Gateway側でも本文ログとキャッシュを無効にしてから利用する。送信先とデータ利用条件は設定画面で確認できる。

Claude / GPTのBYOKでは、従来どおり各提供元の検索と一次情報の出典付きで事実の指摘も返す。標準モードの利用には運営者によるWorkers PaidプランとAI bindingの設定が必要（同モデルは無料枠の対象外）。検索には`CLOUDFLARE_AI_GATEWAY_ID`と、GatewayのクレジットまたはCeramic.aiの登録キーが必要。新しい検索経路の実モデル・実検索での確認は未実施。

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
│   ├── providers/     # モデル呼び出しと上流HTTP通信
│   └── search/        # Web Search API検索、参照先の取得、引用の照合
└── durable-objects/   # 状態を持つDOクラス（校閲の同時実行枠）
```

モデル呼び出しを追う場合は、標準モードの `review/providers/workers-ai.ts`、BYOKの `review/providers/gateway.ts`、ローカル試用の `review/providers/opencode.ts` を読む。HTTPから呼び出す箇所は `http/app.ts`。

校閲入力は `review/input.ts` のZodスキーマを正本にし、`http/app.ts` の `zValidator` で検証する。入力の型もスキーマから推論し、Hono RPCで拡張へ伝える。
