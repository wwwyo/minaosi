# 校閲サーバーと Workers AI / AI Gateway

標準モードは、拡張の background → minaosi の校閲サーバー → Workers AI binding（`env.AI`）の順で通信する。BYOKモードは、校閲サーバー → Cloudflare AI Gateway → 選んだ AI プロバイダーの順で通信する。校閲サーバーは TanStack AI で検索・tool calling を実行し、指摘を共通形式へ検証して返す。拡張側の UI と本文への適用は従来どおり。

AI呼び出しのSDKはTanStack AIに統一しているが、接続経路とプロバイダー差分は残る。`apps/api/src/review/providers/workers-ai.ts` は標準モードの `env.AI` binding経路（`createCloudflareText`）、`apps/api/src/review/providers/gateway.ts` はBYOKのGateway経由の校閲、`apps/api/src/review/providers/opencode.ts` はローカル試用のOpenAI互換経路を担当する。`apps/api/src/review/providers/anthropic.ts` は固定したTanStack Anthropic adapterで失われる `pause_turn` の継続を補う。独立したAnthropic SDK呼び出し経路ではない。校閲ループの共通処理には重複が残っており、完全に一本化した構成ではない。

## 標準モードとBYOK

既定はminaosiの標準モード。利用者に接続先・キー・モデルを選ばせず、サーバー側の Workers AI binding と `DEFAULT_REVIEW_MODEL` だけで実行する。モデルの既定値は `cloudflare.config.ts` で `@cf/deepseek-ai/deepseek-v4-flash-0731`（Cloudflare版のDeepSeek V4 Flash。外部APIの `deepseek-flash` とは別物）を設定する。利用者のログイン・APIキー・プロバイダー契約は不要で、運営者のプロバイダーキーも使わない。AI bindingが未設定なら503（準備中）を返す。標準モードのAI料金は運営者のWorkers AI課金に発生し、同モデルはWorkers Paid必須（無料枠の対象外）。日本語校閲の品質は実測していない。

自分のキーを使う場合は、ブラウザの拡張機能メニューから「オプション」を開き、「自分のAPIキー」を選ぶ。モデルのコンボボックスとAPIキーを入力し保存する。接続先はモデルID（Claude / GPT / o系 / DeepSeek）から判定する。拡張はキーを接続先ごとにローカルに保存し、校閲ごとに `x-minaosi-api-key` ヘッダーでサーバーへ渡す。サーバーはそのリクエストの間だけキーを使い、アカウント・Cookie・Gatewayへのキー登録は要求しない。本番ではプロバイダーへの直接接続へのフォールバックはない。

標準モデルには組み込み検索がないため、校閲サーバーが `web_search`（DuckDuckGoのHTML検索）と `read_source`（検索結果にあるページの本文取得）をfunction toolとして提供する。検索用のAPIキーは不要。検索は最大3回、本文取得は最大6回で、個々の取得を12秒・512KiBまでに制限する。各リダイレクト先も公開HTTPSのURLか検証し、認証付きURLや内部アドレスのリテラルは拒否する。原稿全文・校閲結果をDuckDuckGoへ送らず、短い検索語だけを送る。

事実の指摘は、同じ校閲で取得した参照先と本文内の引用が照合できた場合だけ採用する。出典の一次性や主張との関係はモデルが判定するため、引用の一致だけで事実の正しさを保証するものではない。検索結果の抜粋のみ、未取得のURL、本文に存在しない引用は根拠にしない。PDFなど非対応の形式や検索のアクセス制限は未確認として扱い、誤字・日本語ルールの校閲を続ける。応答の `factCheck` は参照先を取得したブロックを示すもので、原稿全体の確認完了を意味しない。原稿・検索語の送信先と学習への利用は拡張の設定画面に表示する。DuckDuckGoの検索語の学習への利用条件と自動取得の利用条件は、公開前の確認事項として残る。

BYOKのDeepSeekはTanStackの `OpenAIChatCompletionsTextAdapter` でGatewayの `/deepseek/chat/completions` を呼び、OpenAIのResponses APIと内蔵検索toolは送らない。通常endpointでは `strict: false` のfunction toolを使い、`thinking: { type: 'disabled' }` を明示する。thinkingを有効にするとtoolの継続時に `reasoning_content` の完全な再送が必要になるため、現adapterのまま既定のthinkingを使わず、事実指摘は除外する。Claude / GPTのBYOKでは各提供元の検索による事実確認を引き続き利用できる。[DeepSeekのモデルID](https://api-docs.deepseek.com/quick_start/pricing)、[thinkingの仕様](https://api-docs.deepseek.com/guides/thinking_mode)、[Gatewayの検索対応](https://developers.cloudflare.com/ai-gateway/usage/web-search/)。

BYOKモードで利用者のキーがないリクエストは必ず拒否し、標準モード（運営者課金）への自動切り替えはしない。Gateway の認証トークンはBYOK用にサーバーだけに置き、拡張には含めない。BYOKのGatewayリクエストではキャッシュと本文ログをリクエスト単位で無効化する。Workerには本文・キーを含めない実行結果のログだけを残す。AI プロバイダー側のデータ保持は各社の契約・設定に従う。

この方式はGatewayにキーを保存する方式とは異なる。複数端末への同期や、保存キーを匿名端末トークンで利用する仕組みはまだ実装しない。拡張のローカル保存は秘密専用の保管庫ではなく、端末や拡張が侵害された場合のキー流出は防げない。

## ローカル起動

```bash
mise install
mise exec -- bun install
mise exec -- bun run api:dev
# 別の Orca terminal
mise exec -- bun run dev
```

`api:dev` は `cf dev --mode development` でWorkersのローカルシミュレーターを `http://127.0.0.1:8787` に起動する。開発用拡張の接続先は既定で `/review`。Bunの別サーバーは使わない。`GET /health` の `configured` はAI bindingの有無だけを返し、AIを呼び出さない。ローカルのAI bindingは `cloudflare.config.ts` の `dev.remote` でCloudflareのAPIへ転送するため、標準モードの実モデル実行にはCloudflareの認証（cf auth）とWorkers Paidプランが必要。Gateway用secretは標準モードでは不要。

次の環境変数を mise から注入する。秘密は secret-env skill の mise + age の手順で管理し、平文の `.env` や `.dev.vars` は作らない。標準モードはAI bindingだけで動き、Gateway接続の3変数はBYOKにだけ必要。

| 変数 | 用途 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | BYOKで使うGatewayを所有するアカウント |
| `CLOUDFLARE_AI_GATEWAY_ID` | BYOKで使うGateway |
| `CF_AIG_TOKEN` | BYOKのGateway接続用トークン（AI Gateway Run権限）。標準モードには不要 |
| `DEFAULT_REVIEW_MODEL` | 標準モードの固定モデルID。configの既定値は `@cf/deepseek-ai/deepseek-v4-flash-0731` |
| `REVIEW_GATEWAY_ID` | 標準モードの推論をGateway経由でログへ残す場合だけ設定する。未設定ならGatewayを通らない |
| `ALLOWED_ORIGINS` | 拡張で利用する場合は必須。許可する拡張のOriginをカンマ区切りで指定 |
| `TURNSTILE_SITE_KEY` | Turnstile widget の sitekey。秘密ではなく `/turnstile` の widget ページへ埋め込む。development は always-pass のテストキーが既定 |
| `TURNSTILE_SECRET_KEY` | siteverify 検証用の secret。development で sitekey がテストキーなら未設定でもテスト secret を使う |

拡張のOriginは `chrome-extension://<拡張ID>` など。開発・本番とも、使用する拡張のOriginを設定する。Origin付きのリクエストは未設定では403となる。Chrome / Firefoxや開発版 / 配布版でOriginが違う場合はそれぞれ指定する。通常のWebサイトからのCORSは許可しない。Originのないリクエストにも同じモード別の認証条件を適用する。ローカルサーバーはループバックにだけbindする。

開発時の実AI呼び出しはプロジェクト規約に従いOpenCodeを使う。developmentモードだけ、OpenCode Goの `space-bunny-free` をTanStack AIのChat Completions adapterから呼ぶBYOK経路を有効にする。オプションで「自分のAPIキー」と「Space Bunny Free」を選び、miseで管理した `OPENCODE_API_KEY` を登録する。この経路はCloudflare設定を要求せず、ローカルWorkerからOpenCode Goへ接続する。Gateway設定がなくてもローカル試用は動くため、起動時のGateway用secret未設定の警告はこの用途では問題ない。Web検索を使えないため誤字・日本語表現だけを指摘し、事実の指摘は返さない。通常ビルドではこの経路を無効にし、仮にdevelopmentモードの設定を使ってもループバック以外のリクエストは拒否する。Anthropic / OpenAIの実キーを開発QAに使わない。

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

stdinにはcfのJSON Merge Patch形式（`{"SECRET_NAME":{"type":"secret_text","text":"…"}}`）のJSONを、秘密管理ツールから渡す。実値をコマンド引数・履歴・trackedファイルに置かない。Workerがまだ存在しない初回 deploy では `secrets bulk` が使えないため、`cf deploy --secrets-file <path>` で secret を一緒に渡す。secrets-file は `SECRET_NAME=value` を1行ずつ書いた .env 形式で通った実績がある（JSON 形式も可）。接続用の `CF_AIG_TOKEN` と、デプロイ・設定更新用の `CLOUDFLARE_API_TOKEN` は用途を分ける。Gateway接続設定がない場合、BYOKの校閲APIは503を返して外部送信しない。標準モードはこれらのsecretなしで動き、AI bindingがない場合だけ503を返す。

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

## Turnstile による人間性の確認

`POST /review` は認証なしの公開エンドポイントで、per-IP のレート制限は分散 IP からの連打を止めない。入口として Cloudflare Turnstile の人間性確認を追加し、拡張は校閲実行のたびに widget でトークンを発行して `cf-turnstile-response` ヘッダーで送る。Worker はまずトークンの有無と形式だけを確認し（403、外部送信なし）、rate limit を通過してから siteverify で検証する。siteverify を先に呼ぶと、偽トークンの連打がそのまま外部への subrequest 増幅になるため。検証に失敗した場合は403、確認サービスへの接続失敗・タイムアウトは503を返す。siteverify へ送るのは secret・トークン・呼び出し元IPだけで、原稿やBYOKのキーは送らない。応答は `success` に加え、`hostname` が要求ホストと一致すること・widget側の `action`（`review`）が一致すること・送っていない `cdata` が返らないことを検証する。

標準モードとBYOKの両方に適用する。BYOKの推論料金は利用者のキーに発生するが、Worker の invocation や枠管理は共有インフラであり、BYOK だけ検証を外すとエンドポイント自体への連打の抜け道が残るため。

### widget の置き場所

widget ページは校閲サーバーの `GET /turnstile` が配り、拡張の side panel がそのページを隠し iframe で開く。「見直す」のたびに side panel が postMessage で実行を依頼し、トークンを受け取って `run` コマンドに載せる。対話が必要な判定になったときだけ widget を pane 内に表示する。拡張の document は MV3 の CSP で remote script（`challenges.cloudflare.com` の api.js）を読めず、content script からページ DOM へ埋めると surface 側の frame-src CSP に遮られるため、この構成にした。API オリジンに置くことで surface ごとの CSP 差を吸収し、multi-surface にもそのまま使える。トークンは実行を依頼した親オリジンにだけ返す。

任意の Web サイトが `/turnstile` を iframe で埋め込めると、hostname が校閲サーバーになる正当なトークンをサーバー側の照合をすり抜けて量産できてしまう。ページは CSP の `frame-ancestors` で拡張のオリジン（`chrome-extension:` など）だけに埋め込みを制限し、保険としてページ内でも `location.ancestorOrigins` を確認して拡張以外への埋め込みでは widget を描画しない。

### 本番キー

本番 widget（`minaosi-review`、invisible）は `minaosi-review.mix-mix.workers.dev` を hostname に登録済みで、sitekey は `cloudflare.config.ts` の `TURNSTILE_SITE_KEY` に入っている。secret は `cf deploy --secrets-file` で Worker へ登録済み。登録状態は `cf turnstile widgets list` で確認できる。別環境で作り直す場合の手順:

1. `cf turnstile widgets create --body '{"name":"<widget名>","domains":["<公開ホスト名>"],"mode":"invisible"}'` で widget を作成する（`mode` は生成されたフラグに無いため `--body` で渡す）。invisible は常時は表示されず、対話が必要な判定のときだけ challenge が表示される。hostname には Worker の公開ホスト名（`minaosi-review.<アカウント>.workers.dev` またはカスタムドメイン）を登録する。
2. 発行された sitekey を `apps/api/cloudflare.config.ts` の `TURNSTILE_SITE_KEY` に設定する。
3. secret key を Worker へ登録する（上記の `cf workers secrets bulk` と同じ手順）。

`TURNSTILE_SECRET_KEY` が無く sitekey もテストキー以外なら `/review` は503を返す（fail closed）。本番で必ず実キーを設定する。テスト用の鍵ペアの一覧は [Testing](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) を参照。

Workerの実行入口は `apps/api/src/index.ts`。通常のリクエスト処理と、Workers固有のDOクラスをここでexportする。DOクラスはWorker用の型チェックで検証し、BunのHTTP処理テストにはWorkersのruntime moduleを読み込ませない。

## 実行結果のログ

`skipCache: true` は、Gatewayに校閲結果をキャッシュさせず、同じ原稿でも事実確認を含めて毎回実行するための設定。同一リクエストの再利用による費用・待ち時間の削減は得られない。キャッシュは本文の完全一致が前提なので、原稿が変わる通常の校閲では利用できる場面が限られる。[Cloudflareのキャッシュ仕様](https://developers.cloudflare.com/ai-gateway/features/caching/)。

BYOKのGatewayへのリクエストには `cf-aig-collect-log: true` と `cf-aig-collect-log-payload: false` を付ける。モデル・プロバイダー・トークン数・費用・ステータス・処理時間などのメタデータを記録し、原稿を含むリクエスト本文とAIの応答本文は保存しない。Gateway自体の設定でログを無効にしていても、リクエスト単位でこの方針を適用する。[Cloudflareのログ仕様](https://developers.cloudflare.com/ai-gateway/observability/logging/)。

標準モードは `REVIEW_GATEWAY_ID` を設定した場合だけGatewayを通り、binding経路の `gateway` オプションに `collectLog: true` と `skipCache: true` を渡す。BYOK用の `CLOUDFLARE_AI_GATEWAY_ID` があっても標準経路へは流用しない — binding経路ではリクエスト単位のpayload抑制ヘッダー（`cf-aig-collect-log-payload`）を送れず、BYOK用Gatewayのpayload保存設定をそのまま共有できないため、専用のopt-in変数に分けた。`REVIEW_GATEWAY_ID` を設定する場合は、先にそのGatewayでログのpayload保存を無効にする。ローカルOpenCode Go経路はGatewayを通らないため、このログの対象外。

`POST /review` ごとに、`event`、ランダムな `requestId`、HTTP `status`、`durationMs` を構造化ログに記録する。5xxはerror、それ以外は通常のログにする。原稿・APIキー・リクエストURL・上流エラー本文は記録しない。URLなどを自動記録するinvocation logsとtracesも無効にしている。

ローカルではOrcaのサーバーターミナルに表示される。公開WorkerではCloudflareのWorkers Logsに保存され、WorkerのObservability画面で検索できる。2026-10-01確認時点で、Freeは1日20万件・3日保存、Paidは月2,000万件込み・7日保存、超過は100万件あたり$0.60。Workersプランの基本料金・AI利用料は別。設定は `apps/api/cloudflare.config.ts` の `observability.logs` にあり、サンプリング率は現在100%。保存ログは監査台帳や長期保存には使わない。

型チェックでは `cf workers types` でbinding・runtimeの型を生成し、Worker用の `apps/api/src/tsconfig.json` と拡張用の型チェックを分ける。Workersの型をブラウザ側へ混ぜるとDOMの型と衝突するため、生成物は拡張用の対象から除外する。

参照: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[ローカル開発](https://developers.cloudflare.com/workers/local-development/)。

参照: [TanStack Cloudflare adapter](https://tanstack.com/ai/latest/docs/adapters/cloudflare)、[Cloudflare BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)。

## Hono RPC

HTTPルートと入力検証は`apps/api/src/http/app.ts`に定義する。`apps/api/src/rpc.ts`はその`AppType`などの型だけをexportし、拡張は`hc<AppType>`でPOSTする。プロンプトと校閲ルールはAPIだけが持ち、拡張はサーバーの設定やAI SDKを実行時にimportしない。Hono RPCの型推論に加え、APIの入力・AI応答とブラウザの受信境界には実行時検証を残す。

Cloudflare Vite pluginはWranglerに依存しない2.0 betaを使う。7日cooldownを満たす最新の `2.0.0-beta.sha-b747ec8ea` とVite `8.3.0` にexact固定している。型生成は `cf workers types` に統一する。
