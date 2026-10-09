# E2E の実行設計

実行対象はビルドした Chromium 拡張とローカルの合成執筆画面である。操作・画像判定に使う実モデルと、拡張から送る校閲リクエストの偽 API は別の経路である。要件と assertion の対応は [tests/README.md](../tests/README.md) に置く。認証境界は [ADR-0006](adr/0006-use-access-for-e2e-model-transport.md) に記録する。

## 調査した既存設計

開始点は `15923d5`。`e2e.config.ts` は OpenCode Go の操作用 key を読み、実拡張を attempt ごとの profile にロードしていた。`tests/support/site.ts` の偽 `/review`・`/turnstile`、auto-review の design、multi-surface の research、git history を調べたが、途中の Access 実行設計は見つからなかった。`.agent/` はこの worktree に存在しなかった。ここから先は今回の判断であり、過去の合意を復元したものではない。

| credential | 使う場所 | 今回の扱い |
| --- | --- | --- |
| `OPENCODE_API_KEY` | OpenCode Go の provider credential | E2E client は読まず、Gateway 側の保管・注入を接続の前提とする |
| `OPENCODE_E2E_MODEL` | E2E 操作用モデルの選択 | global mise の `mimo-v2.6-flash` を維持し、runner/preflight に渡す。未設定は失敗 |
| `CF_AI_ACCESS_URL` | E2E 操作用 LLM の HTTPS request URL | mise + age から読む。平文の URL/domain を文書・PR・ログに載せない |
| Access session JWT | 操作用 LLM の HTTP transport | cloudflared の既存 session を subprocess の stdout pipe で受け取り、メモリ内で request に付ける |
| 本番 `CF_AIG_TOKEN`・利用者の BYOK key | 校閲 API | 変更しない。`docs/review-gateway.md` の説明は有効 |
| 合成 BYOK key・合成 Turnstile token | 専用 profile と偽 API | 本物ではない。永続化と送信 protocol の確認だけに使う |

## Transport と操作モデル

`@ai-sdk/openai-compatible@3.0.62` の custom fetch に Access 認証を接続する。SDK には固定の placeholder URL だけを見せる。実 URL は transport が読み、`cf-access-token` は SDK の request object を変更せず HTTP request にだけ付ける。network error・非成功の body・response URL・response headers は SDK に返さず、安全なコードと案内に置き換える。成功 JSON に接続先や JWT が echo された場合も除去する。Gateway key と Authorization header は送らない。

`cloudflared access token --app` は既存 session を取得するだけで、`access curl` と異なり自動ログインを開始しない（[2026.9.3 の実装](https://github.com/cloudflare/cloudflared/blob/2026.9.3/cmd/cloudflared/access/cmd.go)）。取得を5秒に制限し、JWT の `exp` が60秒以内なら実推論前に失敗させる。これはローカルの期限確認であり、署名・policy は Access が検証する。各 request で session を取得し直すため、人が別 terminal で更新した session を使える。401/403/redirect は再ログインが必要として終了し、HTML を推論成功として扱わない。

操作モデルは global mise の `OPENCODE_E2E_MODEL=mimo-v2.6-flash` を使う。Access 認証への変更とモデル選択を分離し、Gateway の custom provider `opencode-go` に対する `custom-opencode-go/<モデルID>` へ変換する。未設定・provider prefix 付きの値は接続前に失敗し、別モデルや直接 OpenCode への fallback は設けない。[MiMo の画像対応](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/image-understanding)に加え、SDK の schema 出力・画像判定・tool call は `check:e2e:model`、実 UI の正負判定と操作は実拡張 E2E で確認する。

Gateway の [custom provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/) は slug を `opencode-go`、`base_url` を `https://opencode.ai/zen/go` とする。request の model は `custom-opencode-go/mimo-v2.6-flash` にする。2026-10-09、Access 経由の赤・青画像の schema 判定と画像付き tool call の単独実行で、この経路の通信を確認した。

[BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/) の秘密名は公式の `${gateway_id}_${provider_slug}_${alias}` に従う。今回動作を確認した構成では、Secrets Store に scope `ai_gateway` の秘密を先に作り、その `secret_id` を Gateway の provider key 設定に関連付けた。provider key 設定は `provider_slug: opencode-go`、`alias: default`、`default_config: true` とする。request model の `custom-` prefix はこの `provider_slug` には付けない。`custom-opencode-go` を provider key 設定に使った構成では、HTTP 400・internalCode 2044（credentials required）になった。

管理操作は `cf` を使い、credential を含む入力は `--body @/dev/stdin` で渡す。dry-run を含む出力も秘密や ID を含む可能性があるため、メモリ内で必要な項目だけを確認し、実値をログ・文書・PR に載せない。credential 登録用の repo 専用 script は追加しない。

runner は Access JWT だけを認証に使い、provider key を env・SDK・Chromium に渡さない。OpenCode 操作用の User-Agent と worker ごとのランダム session ID は transport に付ける。[Access JWT は Gateway の request credential として使える](https://developers.cloudflare.com/ai-gateway/configuration/cloudflare-access/)が、upstream の provider 認証には Gateway 側の保管・注入が必要である。既存の個人 Access policy、authentication、byok_only、zdr、cache、rate の設定は変更していない。

当初は global のモデル指定を旧 key 設定と一緒に扱い、Gemma 4 を選定した。これは認証移行に伴う必要な変更ではなく、利用者が指定していた MiMo を見落とした判断だった。MiMo の指定を維持し、認証だけを Access へ移す。Gemma/Scout の実測は[過去の検証記録](e2e-validation.md)に残すが、MiMo の成功の根拠には使わない。接続設定後の能力 preflight は成功した。途中の失敗も検証記録に残し、現在 head の実拡張 E2E と独立 QA の結果は PR に SHA とともに記録する。能力確認と実拡張 E2E の両方が成功するまで移行の QA 完了とはしない。

curl を request ごとに実行する案は認証が簡単だが、自動ログインや stdout/headers の扱いが SDK と合わない。ローカル proxy を設ける案は token が別サービスへ広がり、readiness・cleanup も増える。既存 SDK に小さな transport を接続してこの負担を避ける。

## 実行の責務とトリガー

| 実行 | トリガー | 確認するもの | 確認しないもの |
| --- | --- | --- | --- |
| ローカル `test:e2e` | E2E・拡張の変更、PR の独立 QA、操作モデル変更 | 実 Chromium 拡張、合成画面、実 Access モデルの操作・画像判定、DOM・永続化・送信の assertion | 実校閲の品質・Turnstile 検証・実サービスへの対応 |
| CI `test:e2e:offline` | pull_request、main push、workflow_dispatch | 同じ実拡張のうちモデル不要の要件、transport の境界テスト、E2E 型チェック | `model` tag の操作・vision。API key や個人 session は CI に渡さない |
| 実校閲 integration | 校閲の挙動・binding・provider を変える PR で明示的に実施 | `bun run api:dev` の workerd から実 AI・外部サービスへの通信、実 Turnstile、必要な実 surface | 対象外の surface・ブラウザ・校閲品質は個別に記録する |

Access に個人ログインしかない現状では、GitHub-hosted runner に実モデル E2E の無人実行を置けない。CI の緑は全 E2E の完了を意味しない。将来の無人経路には専用 identity・policy・課金責任の別設計が必要であり、今回は既存 Access policy を変更しない。

この PR の実校閲 integration は未実施である。合成 API の成功を代わりにせず、[検証記録](e2e-validation.md)の未確認範囲として残す。

## 実行上限とライフサイクル

- attempt ごとに一時 profile を作る。通常の Chrome profile は参照しない。development build が無ければ失敗し、production build に fallback しない。
- worker は1、retry は0、replay cache は off。固定の偽 API port `18787` と options URL の受け渡しが単一 worker を前提とするため、複数 run を同時に起動しない。
- runner が site と偽 API を起動し、`/__health` を readiness とする。port 競合は失敗。各テストで観測用送信一覧を reset し、前のテストの送信を数えない。
- attempt 120秒、launch 60秒、Chromium launch 30秒、操作15秒、通常 assertion 10秒、モデル judgment/HTTP 60秒、cleanup 30秒。既存の自動校閲の30秒待機は副作用の安定待ちとして維持する。
- `agent.act` は最大10 steps/10 model calls（操作 smoke は6）。`maxInputTokens: 32,768` は judgment の入力推定上限であり、act では観測を縮小する予算に使う。固定 runner は act の履歴・tools 全体にこの token 上限を検査しないため、request 全体32,768とは扱わない。transport は画像・履歴・tools を含む request body を256 KiB、worker を60 HTTP requests、output を各 request 最大2,048 tokens に制限する。ローカルでは正確な画像 token 数を測定しない。runner の内蔵 SDK retry 5回も HTTP 上限へ数え、transport で再試行は足さない。output は60×2,048の枠で、実 input/token 単価による課金額は report と provider usage で確認する。
- wrapper は build/preflight を3分、run を15分に制限し、SIGTERM で runner の cleanup を開始する。runner の attempt 120秒＋cleanup 30秒に5秒の余裕を置き、155秒で終わらなければ2回目の SIGTERM で worker を強制 teardown する。さらに cleanup の猶予を置き、190秒で3回目を送り runner 自身に detached app groups を終了させる。195秒でなお止まらなければ runner group を SIGKILL する。runner は terminal と別の process group に置き、同じ interrupt が二重に届くことを防ぐ。build/preflight の最終猶予は35秒。OS 停止や最終 SIGKILL では cleanup を保証できない。profile と port の残存を調べ、この run の残存だけを処理する。
- build と runner に継承する環境変数を限定し、key・age 復号キーを渡さない。runner と preflight だけに Access URL とモデル ID を渡す。site は `env -i`、Chromium は PATH/HOME だけを継承する。JWT は env に入れない。
- wrapper は child の終了まで SIGINT/SIGTERM の handler を維持する。終了処理の途中で同じ signal を繰り返しても wrapper だけが終了せず、最初に開始した有限の終了待機を継続する。

## 証跡と運用

結果は `.e2e/report.json`、JUnit は `.e2e/junit.xml`、画像と Playwright trace は `.e2e/artifacts/`。`.e2e/` は gitignore する。失敗時も `release` のログ、profile 削除、site の port 解放を確認する。次の run が artifacts を消すため、失敗の調査前に再実行しない。必要な過去の証跡は `.e2e/history/` に退避する。

モデル telemetry は wrapper の起動時から無効化する。AI trace は既定で生成しない。公開する証跡は合成データに限り、実 URL/domain、Access JWT、API key が無いことを確認する。CI は秘密のない offline run の report・JUnit・UI artifacts のみを7日保存する。

手順、失敗コードと対話ログインの復旧は [tests/README.md](../tests/README.md) を参照する。今回の実行結果は [検証記録](e2e-validation.md) に残す。
