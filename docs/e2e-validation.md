# Access E2E 移行の検証記録

2026-10-08、`wwwyo/e2e-access` のローカル実行。最終 head の独立 QA と CI の結果は PR の QA 欄で SHA とともに記録する。以下は実装中の実測であり、後続の変更に自動的に引き継がない。

| コマンド・確認 | 結果 | 範囲・証跡 |
| --- | --- | --- |
| `mise exec -- bun run check:e2e:model` | Gemma 4 の赤・青画像、JSON schema、画像 tool call の3 requests 成功 | 合成画像のみ。実 UI の細部はこの確認だけでは保証しない |
| `mise exec -- bun run test:e2e` | Gemma 4、10/10 passed、7 model calls、16,830 tokens、152.33秒 | run `01a11a9f-8405-7534-aadb-8a9299f72aa7`。`.e2e/history/gemma/report.json` と artifacts に退避。assertion と trace・正負の screenshot を確認 |
| `mise exec -- bun run test:e2e:offline` | 4/4 passed、model calls なし、60.90秒 | `.e2e/history/offline/`。実拡張のモデル不要部分のみ |
| `mise exec -- bun run test:e2e:transport` | 8/8 passed | HTTP 境界と CLI session fixture。未設定・期限切れ・401/403/redirect・HTML・不正JSON・モデル拒否・キャンセル・60 requests・秘密除外 |
| `mise exec -- bun run check` | API/extension/E2E 全て成功 | `cf workers types`、WXT prepare、TypeScript |
| `mise exec -- bun test apps` | 135/135 passed | 既存の API/extension テスト。実 AI には接続しない |
| `mise exec -- bun run check:e2e:artifacts` | 34ファイル（ZIP内含む）、leaks 0 | 実 URL/host・既知の key・age 復号キー・JWT を含まない文字列検査。画像内容は目視と profile 分離で補う |
| 実 Access へ認証無し HTTP | 401、choices なし | redirect は追従せず、URL/body は出力していない |
| 実 Access へ存在しないモデルを指定 | HTTP 400、`ACCESS_MODEL_HTTP` | 成功扱い・fallback・再ログインなし |
| 実 cloudflared を空 HOME で起動 | `ACCESS_SESSION_MISSING` | subprocess の出力は pipe 内のみ。対話ログインを開始せず終了し、一時 HOME を削除 |

初期候補の Llama 4 Scout は能力 preflight を通過し、実拡張9件中8件成功したが、自動校閲の起動ボタン画像を誤って否定した（run `01a11a9c-fd7e-7dea-8387-4ad882d61677`、104.20秒）。画像では右下に m 字ロゴとリングが存在した。失敗は `.e2e/history/scout/` に保存し、assertion を緩和せず Gemma 4 を選定した。

中断検証では、初回 Ctrl-C が wrapper と同じ process group の runner に二重に届き、強制 teardown で一時 profile が残った。port は解放された。対象 Chromium の終了を確認してこの run の profile だけを削除し、runner を別 process group にして一度だけ SIGTERM を送るよう修正した。修正後、実拡張から偽 API に送信されたことを観測して wrapper に SIGTERM を送り、run `01a11aa8-025a-72c9-845f-e51b8728b4d4` は5.56秒で exit 130、report は interrupted、profile 残存0、port 解放を確認した。中断をテスト成功として数えてはいない。

実校閲・実 Turnstile・実サービス編集画面・side pane のブラウザ chrome 開閉・Firefox・本番 BYOK の実通信・文体/事実確認品質は未実施。合成校閲 API の応答と操作用 LLM の実推論は別々の確認である。CI は個人の Access session を持たず、モデル不要の4件だけを実行する。
