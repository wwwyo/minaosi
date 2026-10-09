# Access E2E 移行の検証記録

2026-10-08〜09、`wwwyo/e2e-access` のローカル実行。最終 head の独立 QA と CI の結果は PR の QA 欄で SHA とともに記録する。以下は実装中の実測であり、後続の変更に自動的に引き継がない。

## MiMo 指定への修正

操作モデルを global mise の `mimo-v2.6-flash` に戻し、Access の OpenCode Go custom provider 経路を選択する。モデルの未設定・不正値は wrapper が接続や browser 起動前に拒否する。Gemma の成功はこの経路の成功として扱わない。

| コマンド・確認 | 結果 | 範囲 |
| --- | --- | --- |
| `mise exec -- bun run check:e2e` | 成功 | MiMo の環境変数・transport を含む E2E 型チェック |
| `mise exec -- bun run test:e2e:transport` | 11/11 passed、347 assertions | 既存の認証境界に加え、MiMo の model ID 変換、未設定・不正値、操作 session の分離 |
| `OPENCODE_E2E_MODEL` を空・provider prefix 付きにした preflight | `E2E_MODEL_MISSING` / `E2E_MODEL_INVALID`、exit 2 | 実モデルや browser を起動しない |
| `mise exec -- bun run check:e2e:model` | `vision-red` で HTTP 502、exit 1 | `custom-opencode-go/mimo-v2.6-flash`。vision・schema・tool call の成功は未確認 |
| OpenRouter の MiMo 経路の最小接続 | HTTP 400 | fallback として採用していない |

上表の HTTP 502 時点では cf CLI の管理認証が未設定だった。2026-10-09、管理ログイン後に Access URL に対応する Gateway を確認し、OpenCode Go custom provider と Secrets Store の provider credential を設定した。Access の既存 policy、Gateway の authentication・byok_only・zdr・cache・rate 設定は維持した。

| 接続設定後の確認 | 結果 |
| --- | --- |
| provider key を `custom-opencode-go` として登録 | HTTP 400、internalCode 2044（credentials required）。request model の prefix と設定側の slug は異なる |
| provider key を `opencode-go`、alias `default` にして秘密を関連付け | Access 経由の実 MiMo 通信成功。provider key は stdin から Secrets Store に保存し、E2E client に渡していない |
| 能力 preflight の初回 | 赤・青画像の schema 判定後、tool call で `MODEL_CAPABILITY_FAILED`。原因は特定できておらず、成功として数えない |
| 能力 preflight の次の実行 | 赤画像の request が60秒で `ACCESS_CANCELLED`、exit 1。原因は未特定。timeout・assertion・schema は変更していない |
| 同じ3 requests の診断実行 | 赤・青画像の schema 判定、青画像の tool call 成功、18.58秒 |
| `mise exec -- bun run check:e2e:model` | 赤・青画像、JSON schema、画像 tool call の3 requests 成功、exit 0 |
| 調査中の重複設定の cleanup | 誤った prefix の provider config と secret の削除を管理 API の再取得で確認。正しい config 1件、active secret 1件のみ |

Gateway の単独接続成功だけでは QA 完了としない。現在 head の MiMo 実拡張 E2E・独立 QA・CI の実測は PR の QA 欄に SHA とともに記録する。接続遅延やモデル能力の失敗は有限時間で終了させ、key や別モデルへ fallback しない。

## Gemma の過去の検証

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

## Gemma での独立 QA とレビュー

Gemma 4 を使った `c33e089` の独立 QA は実拡張10/10、7 model calls、16,720 tokens、184.94秒で成功した（run `01a11aab-4d89-7542-a899-5428044f63cb`）。215 steps、画像5枚、trace10件の参照と ZIP CRC を確認し、正常終了後の profile 残存0・port 解放、77 artifacts の leaks0を確認した。ただし128 output tokens の能力 preflight は `MODEL_CAPABILITY_FAILED` で失敗した。再実行の緑だけでは完了扱いせず、preflight の出力枠を512へ増やし、失敗 stage と finishReason/usage だけを診断に追加した。変更後の最初の確認は HTTP429で失敗し、その後の最小接続確認では HTTP200・choices を得た。429の原因は特定していない。

レビューから、以下も修正した。最終 head の確認は PR の QA 欄で別に記録する。

- escaped JSON の文字列が SDK で秘密値へ復元されないよう、JSON を解析して値・key を除去してから再 serialize する。escape fixture を含む transport 9件が成功。
- `agent.act` の `maxInputTokens` は履歴全体の上限ではないことを明記し、transport で画像・履歴・toolsを含む256 KiBの request body 枠を追加。
- モデルの保存操作は、先に合成 BYOK を保存し、標準へ変更させてから reload する。初期値と同じ画面だけでは永続化の根拠にしない。
- 本文候補の競合が起きた後にもボタン画像を確認する。
- 終了待機を直接 SIGKILL で打ち切る前に、runner の2回目・3回目の signal を通して detached app groups の停止を開始する。
