# E2E の実行設計

実行対象はビルドした Chromium 拡張とローカルの合成執筆画面である。操作・画像判定に使う実モデルと、拡張から送る校閲リクエストの偽 API は別の経路である。要件と assertion の対応は [tests/README.md](../tests/README.md) に置く。認証境界は [ADR-0006](adr/0006-use-access-for-e2e-model-transport.md) に記録する。

## 調査した既存設計

開始点は `15923d5`。`e2e.config.ts` は OpenCode Go の操作用 key を読み、実拡張を attempt ごとの profile にロードしていた。`tests/support/site.ts` の偽 `/review`・`/turnstile`、auto-review の design、multi-surface の research、git history を調べたが、途中の Access 実行設計は見つからなかった。`.agent/` はこの worktree に存在しなかった。ここから先は今回の判断であり、過去の合意を復元したものではない。

| credential | 使う場所 | 今回の扱い |
| --- | --- | --- |
| `OPENCODE_API_KEY`・`OPENCODE_E2E_MODEL` | 旧 E2E 操作用 LLM | E2E から依存を外す |
| `CF_AI_ACCESS_URL` | E2E 操作用 LLM の HTTPS request URL | mise + age から読む。平文の URL/domain を文書・PR・ログに載せない |
| Access session JWT | 操作用 LLM の HTTP transport | cloudflared の既存 session を subprocess の stdout pipe で受け取り、メモリ内で request に付ける |
| 本番 `CF_AIG_TOKEN`・利用者の BYOK key | 校閲 API | 変更しない。`docs/review-gateway.md` の説明は有効 |
| 合成 BYOK key・合成 Turnstile token | 専用 profile と偽 API | 本物ではない。永続化と送信 protocol の確認だけに使う |

## Transport と操作モデル

`@ai-sdk/openai-compatible@3.0.62` の custom fetch に Access 認証を接続する。SDK には固定の placeholder URL だけを見せる。実 URL は transport が読み、`cf-access-token` は SDK の request object を変更せず HTTP request にだけ付ける。network error・非成功の body・response URL・response headers は SDK に返さず、安全なコードと案内に置き換える。成功 JSON に接続先や JWT が echo された場合も除去する。Gateway key と Authorization header は送らない。

`cloudflared access token --app` は既存 session を取得するだけで、`access curl` と異なり自動ログインを開始しない（[2026.9.3 の実装](https://github.com/cloudflare/cloudflared/blob/2026.9.3/cmd/cloudflared/access/cmd.go)）。取得を5秒に制限し、JWT の `exp` が60秒以内なら実推論前に失敗させる。これはローカルの期限確認であり、署名・policy は Access が検証する。各 request で session を取得し直すため、人が別 terminal で更新した session を使える。401/403/redirect は再ログインが必要として終了し、HTML を推論成功として扱わない。

操作モデルは `workers-ai/@cf/google/gemma-4-26b-a4b-it` に固定する。[公式仕様](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)は vision・function calling を持ち、2026-10-08 時点の価格は input $0.10 / output $0.30 per M tokens。SDK の schema 出力、画像判定、tool call は `check:e2e:model` で実通信確認する。単色の正負判定だけでは細かい UI の品質を保証できないため、実拡張の正・負の画像 assertion と `agent.act` も通す。

Llama 3.1 8B の接続成功は vision の根拠にならない。Llama 4 Scout は事前の画像・schema・tool call を通過し、UI 操作も成功したが、実画像にある起動ボタンを否定したため採用しなかった。Gemma 4 はより安価な候補であり、assertion を緩めず選定・検証する。モデルの自動 fallback は設けず、非対応や品質の失敗を結果に残す。

curl を request ごとに実行する案は認証が簡単だが、自動ログインや stdout/headers の扱いが SDK と合わない。ローカル proxy を設ける案は token が別サービスへ広がり、readiness・cleanup も増える。既存 SDK に小さな transport を接続してこの負担を避ける。

## 実行の責務とトリガー

| 実行 | トリガー | 確認するもの | 確認しないもの |
| --- | --- | --- | --- |
| ローカル `test:e2e` | E2E・拡張の変更、PR の独立 QA、操作モデル変更 | 実 Chromium 拡張、合成画面、実 Access モデルの操作・画像判定、DOM・永続化・送信の assertion | 実校閲の品質・Turnstile 検証・実サービスへの対応 |
| CI `test:e2e:offline` | pull_request、main push、workflow_dispatch | 同じ実拡張のうちモデル不要の要件、transport の境界テスト、E2E 型チェック | `model` tag の操作・vision。API key や個人 session は CI に渡さない |
| 実校閲 integration | 校閲の挙動・binding・provider を変える PR で明示的に実施 | `bun run api:dev` の workerd から実 AI・外部サービスへの通信、実 Turnstile、必要な実 surface | この PR では未実施。合成 API の緑を成功の代わりにしない |

Access に個人ログインしかない現状では、GitHub-hosted runner に実モデル E2E の無人実行を置けない。CI の緑は全 E2E の完了を意味しない。将来の無人経路には専用 identity・policy・課金責任の別設計が必要であり、今回は既存 Access policy を変更しない。

## 実行上限とライフサイクル

- attempt ごとに一時 profile を作る。通常の Chrome profile は参照しない。development build が無ければ失敗し、production build に fallback しない。
- worker は1、retry は0、replay cache は off。固定の偽 API port `18787` と options URL の受け渡しが単一 worker を前提とするため、複数 run を同時に起動しない。
- runner が site と偽 API を起動し、`/__health` を readiness とする。port 競合は失敗。各テストで観測用送信一覧を reset し、前のテストの送信を数えない。
- attempt 120秒、launch 60秒、Chromium launch 30秒、操作15秒、通常 assertion 10秒、モデル judgment/HTTP 60秒、cleanup 30秒。既存の自動校閲の30秒待機は副作用の安定待ちとして維持する。
- `agent.act` は最大10 steps/10 model calls（操作 smoke は6）、input は request あたり32,768 tokens。transport は worker あたり60 HTTP requests、output は各 request 最大2,048 tokens。runner の内蔵 SDK retry 5回も HTTP 上限へ数える。transport で再試行は足さない。最大 input は60×32,768、output は60×2,048の予算枠で、provider の画像 token 計測や価格変更まで保証する課金上限ではない。
- wrapper は build/preflight を3分、run を15分に制限し、SIGTERM で runner の cleanup を開始、35秒で終わらなければ SIGKILL とする。runner は terminal と別の process group に置き、同じ interrupt が二重に届いて強制 teardown になることを防ぐ。強制終了や OS 停止では cleanup を保証できない。profile と port の残存を調べ、この run の残存だけを処理する。
- build と runner に継承する環境変数を限定し、key・age 復号キーを渡さない。runner だけが Access URL を読む。site は `env -i`、Chromium は PATH/HOME だけを継承する。JWT は env に入れない。

## 証跡と運用

結果は `.e2e/report.json`、JUnit は `.e2e/junit.xml`、画像と Playwright trace は `.e2e/artifacts/`。`.e2e/` は gitignore する。失敗時も `release` のログ、profile 削除、site の port 解放を確認する。次の run が artifacts を消すため、失敗の調査前に再実行しない。必要な過去の証跡は `.e2e/history/` に退避する。

モデル telemetry は wrapper の起動時から無効化する。AI trace は既定で生成しない。公開する証跡は合成データに限り、実 URL/domain、Access JWT、API key が無いことを確認する。CI は秘密のない offline run の report・JUnit・UI artifacts のみを7日保存する。

手順、失敗コードと対話ログインの復旧は [tests/README.md](../tests/README.md) を参照する。今回の実行結果は [検証記録](e2e-validation.md) に残す。
