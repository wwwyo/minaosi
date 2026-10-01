# 校閲サーバーと Cloudflare AI Gateway

拡張の background → minaosi の校閲サーバー → Cloudflare AI Gateway → 選んだ AI プロバイダーの順で通信する。校閲サーバーは TanStack AI で検索・tool calling を実行し、指摘を共通形式へ検証して返す。拡張側の UI と本文への適用は従来どおり。

AI呼び出しのSDKはTanStack AIに統一しているが、接続経路とプロバイダー差分は残る。`apps/api/src/review/providers/gateway.ts` はGateway経由の校閲、`apps/api/src/review/providers/opencode.ts` はローカル試用のOpenAI互換経路を担当する。`apps/api/src/review/providers/anthropic.ts` は固定したTanStack Anthropic adapterで失われる `pause_turn` の継続を補う。独立したAnthropic SDK呼び出し経路ではない。校閲ループの共通処理には重複が残っており、完全に一本化した構成ではない。

## 標準モードとBYOK

既定はminaosiの標準モード。利用者に接続先・キー・モデルを選ばせず、サーバーの `DEFAULT_REVIEW_PROVIDER` / `DEFAULT_REVIEW_MODEL` / `DEFAULT_REVIEW_API_KEY` を使う。運営設定がない場合は503（準備中）を返す。標準モードのAI料金は運営者に発生する。

自分のキーを使う場合は、ブラウザの拡張機能メニューから「オプション」を開き、「自分のAPIキー」を選ぶ。モデルのコンボボックスとAPIキーを入力し保存する。接続先はモデルID（Claude / GPT / o系）から判定する。拡張はキーをローカルに保存し、校閲ごとに `x-minaosi-api-key` ヘッダーでサーバーへ渡す。サーバーはそのリクエストの間だけキーを使い、アカウント・Cookie・Gatewayへのキー登録は要求しない。本番ではプロバイダーへの直接接続へのフォールバックはない。

Gateway の `default` 保存キーや運営者の AI 課金を利用しないよう、BYOKモードで利用者のキーがないリクエストは必ず拒否する。標準モードへの自動切り替えはしない。標準モードのキーはサーバーのsecretとして保持する。Gateway の認証トークンはサーバーだけに置き、拡張には含めない。Gateway のキャッシュと本文ログはリクエスト単位で無効化する。Workerには本文・キーを含めない実行結果のログだけを残す。AI プロバイダー側のデータ保持は各社の契約・設定に従う。

この方式はGatewayにキーを保存する方式とは異なる。複数端末への同期や、保存キーを匿名端末トークンで利用する仕組みはまだ実装しない。拡張のローカル保存は秘密専用の保管庫ではなく、端末や拡張が侵害された場合のキー流出は防げない。

## ローカル起動

```bash
mise install
mise exec -- bun install
mise exec -- bun run api:dev
# 別の Orca terminal
mise exec -- bun run dev
```

`api:dev` は `cf dev --mode development` でWorkersのローカルシミュレーターを `http://127.0.0.1:8787` に起動する。開発用拡張の接続先は既定で `/review`。Bunの別サーバーは使わない。`GET /health` の `configured` はGateway接続設定の有無だけを返し、AIを呼び出さない。

次の環境変数を mise から注入する。秘密は secret-env skill の mise + age の手順で管理し、平文の `.env` や `.dev.vars` は作らない。

| 変数 | 用途 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Gatewayを所有するアカウント |
| `CLOUDFLARE_AI_GATEWAY_ID` | 使用するGateway |
| `CF_AIG_TOKEN` | AI Gateway Run権限の接続用トークン |
| `DEFAULT_REVIEW_PROVIDER` | 標準モードの運営指定（anthropic / openai） |
| `DEFAULT_REVIEW_MODEL` | 標準モードの固定モデルID |
| `DEFAULT_REVIEW_API_KEY` | 標準モードの運営用キー。サーバーだけに置く |
| `ALLOWED_ORIGINS` | 拡張で利用する場合は必須。許可する拡張のOriginをカンマ区切りで指定 |

拡張のOriginは `chrome-extension://<拡張ID>` など。開発・本番とも、使用する拡張のOriginを設定する。Origin付きのリクエストは未設定では403となる。Chrome / Firefoxや開発版 / 配布版でOriginが違う場合はそれぞれ指定する。通常のWebサイトからのCORSは許可しない。Originのないリクエストにも同じモード別の認証条件を適用する。ローカルサーバーはループバックにだけbindする。

開発時の実AI呼び出しはプロジェクト規約に従いOpenCodeを使う。developmentモードだけ、OpenCode Goの `space-bunny-free` をTanStack AIのChat Completions adapterから呼ぶBYOK経路を有効にする。オプションで「自分のAPIキー」と「Space Bunny Free」を選び、miseで管理した `OPENCODE_API_KEY` を登録する。この経路はCloudflare設定を要求せず、ローカルWorkerからOpenCode Goへ接続する。Gateway設定がなくてもローカル試用は動くため、起動時のGateway用secret未設定の警告はこの用途では問題ない。Web検索を使えないため誤字・日本語表現だけを指摘し、事実の指摘は返さない。通常ビルドではこの経路を無効にし、仮にdevelopmentモードの設定を使ってもループバック以外のリクエストと標準モードは拒否する。Anthropic / OpenAIの実キーを開発QAに使わない。

## Worker の公開設定

Cloudflare のリソース操作は `cf cli search` でコマンドを確認してから `cf` CLI を使う。検索文にアカウント名・ID・秘密情報を含めない。Workerの設定の正本は `apps/api/cloudflare.config.ts`。開発・ビルド・デプロイの入口はcfに統一する。`apps/api/vite.config.ts` のCloudflare Vite pluginがビルドとworkerdでのローカル実行を担当する。Wranglerへの依存と設定は持たない。開発用のIP・ポートはViteに置き、Worker名・binding・互換性設定は `cloudflare.config.ts` に置く。

```bash
mise exec -- bun run api:dev
mise exec -- bun run api:build
mise exec -- bun run api:deploy
```

本番と同じGateway経路をローカルで確認するときは、`mise exec -- bun run api:worker:dev` を使う。8788で起動し、OpenCode Go経路は無効になる。拡張から検証する場合は、開発用の `WXT_REVIEW_API_URL` を `http://127.0.0.1:8788/review` に設定する。どちらの開発モードもbindingをローカルで模擬する。Gatewayへの実AI呼び出しには上記の接続設定が必要で、シミュレーターの起動だけでは外部AIの設定は完了しない。

`api:build` は `.cloudflare/output/v0/` へビルドし、アップロードは行わない。`api:deploy` はビルド後にWorkerを公開する。デプロイは別途実行する。

Workerのsecretは、運営者またはセルフホストする人が自分のCloudflareアカウントへ登録する。拡張の利用者が登録するBYOKキーとは別の設定であり、BYOKキーをWorkerへ保存しない。登録にはCloudflare管理画面のWorker設定、またはcf標準コマンドを使う。`bindings.secret()`は必要な名前の宣言であり、秘密値を自動アップロードしない。

```bash
cd apps/api
mise exec -- cf workers secrets bulk --worker minaosi-review --file /dev/stdin
```

stdinにはcfのJSON Merge Patch形式（`{"SECRET_NAME":{"type":"secret_text","text":"…"}}`）のJSONを、秘密管理ツールから渡す。実値をコマンド引数・履歴・trackedファイルに置かない。接続用の `CF_AIG_TOKEN` と、デプロイ・設定更新用の `CLOUDFLARE_API_TOKEN` は用途を分ける。設定情報がない場合、校閲APIは503を返して外部送信しない。

cfはNode.jsで実行する。`cf/config` をBunで読み込むことはサポートされないため、miseでNode.jsも管理する。cfは `1.0.0-beta.6` にexact固定し、2026-10-01のユーザー承認で、この依存追加だけ7日cooldownの例外とした。`bunfig.toml` の7日待機設定は維持する。

公開したサーバーの `https://…/review` を `WXT_REVIEW_API_URL` に設定して拡張をビルドする。これは公開URLだけで、トークンやキーを含めない。拡張のhost permissionはこのURLのOriginだけに限定する。設定がない本番ビルドでは外部接続を許可せず、校閲実行時に未設定と表示する。

```bash
mise exec -- bun run build
mise exec -- bun run check
mise exec -- bun test
```

Workerは1IPあたり60秒に10回の呼び出し制限、原稿の文字数・リクエストサイズ制限を持つ。レート制限はCloudflare拠点ごとの近似的な制限で、厳密な全世界共通の利用上限ではない。

標準サービスの同時実行は全利用者・モデル合計で10件に制限する。`apps/api/cloudflare.config.ts` の `REVIEW_POLICY` が上限と実行枠の有効期間（240秒）を指定し、`REVIEW_CONCURRENCY` がSQLite-backed Durable Objectへ接続する。Workerは同じDOインスタンス名 `standard` に枠の取得・解放を依頼する。将来別Workerから共有する場合も、同じnamespaceとインスタンス名を参照する必要がある。

DOは有効な枠の数を確認し、新しい枠を保存する処理をトランザクションで実行する。10件実行中なら待ち行列には入れず429を返す。校閲が完了・失敗したら枠を解放し、Workerの異常終了で解放できなかった枠は期限後の次の取得時に削除する。DOの保存内容はランダムな枠IDと期限だけで、原稿・キー・IPを保存しない。DOの再起動でもSQLiteの枠は保持される。bindingが未設定・取得に失敗した場合は制限を迂回してAIを呼ばない。解放の失敗時は校閲結果を返し、本文を含まない `review_lease_release_failed` イベントだけを記録する。

BYOKは運営者負担の枠を使わず、既存のIPレート制限を適用する。1日100件の利用上限は検討値で、日次カウントはまだ実装していない。同時実行上限は累積料金の上限ではないため、標準モードを一般公開する際は別途費用上限を設ける。

Workerの実行入口は `apps/api/src/index.ts`。通常のリクエスト処理と、Workers固有のDOクラスをここでexportする。DOクラスはWorker用の型チェックで検証し、BunのHTTP処理テストにはWorkersのruntime moduleを読み込ませない。

## 実行結果のログ

`skipCache: true` は、Gatewayに校閲結果をキャッシュさせず、同じ原稿でも事実確認を含めて毎回実行するための設定。同一リクエストの再利用による費用・待ち時間の削減は得られない。キャッシュは本文の完全一致が前提なので、原稿が変わる通常の校閲では利用できる場面が限られる。[Cloudflareのキャッシュ仕様](https://developers.cloudflare.com/ai-gateway/features/caching/)。

Gatewayへのリクエストには `cf-aig-collect-log: true` と `cf-aig-collect-log-payload: false` を付ける。モデル・プロバイダー・トークン数・費用・ステータス・処理時間などのメタデータを記録し、原稿を含むリクエスト本文とAIの応答本文は保存しない。Gateway自体の設定でログを無効にしていても、リクエスト単位でこの方針を適用する。[Cloudflareのログ仕様](https://developers.cloudflare.com/ai-gateway/observability/logging/)。ローカルOpenCode Go経路はGatewayを通らないため、このログの対象外。

`POST /review` ごとに、`event`、ランダムな `requestId`、HTTP `status`、`durationMs` を構造化ログに記録する。5xxはerror、それ以外は通常のログにする。原稿・APIキー・リクエストURL・上流エラー本文は記録しない。URLなどを自動記録するinvocation logsとtracesも無効にしている。

ローカルではOrcaのサーバーターミナルに表示される。公開WorkerではCloudflareのWorkers Logsに保存され、WorkerのObservability画面で検索できる。2026-10-01確認時点で、Freeは1日20万件・3日保存、Paidは月2,000万件込み・7日保存、超過は100万件あたり$0.60。Workersプランの基本料金・AI利用料は別。設定は `apps/api/cloudflare.config.ts` の `observability.logs` にあり、サンプリング率は現在100%。保存ログは監査台帳や長期保存には使わない。

型チェックでは `cf workers types` でbinding・runtimeの型を生成し、Worker用の `apps/api/src/tsconfig.json` と拡張用の型チェックを分ける。Workersの型をブラウザ側へ混ぜるとDOMの型と衝突するため、生成物は拡張用の対象から除外する。

参照: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[ローカル開発](https://developers.cloudflare.com/workers/local-development/)。

参照: [TanStack Cloudflare adapter](https://tanstack.com/ai/latest/docs/adapters/cloudflare)、[Cloudflare BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)。

## Hono RPC

HTTPルートと入力検証は`apps/api/src/http/app.ts`に定義する。`apps/api/src/rpc.ts`はその`AppType`などの型だけをexportし、拡張は`hc<AppType>`でPOSTする。プロンプトと校閲ルールはAPIだけが持ち、拡張はサーバーの設定やAI SDKを実行時にimportしない。Hono RPCの型推論に加え、APIの入力・AI応答とブラウザの受信境界には実行時検証を残す。

Cloudflare Vite pluginはWranglerに依存しない2.0 betaを使う。7日cooldownを満たす最新の `2.0.0-beta.sha-b747ec8ea` とVite `8.3.0` にexact固定している。型生成は `cf workers types` に統一する。
