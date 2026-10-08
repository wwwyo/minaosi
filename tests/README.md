# E2E

共通の `e2e` skill に従い、ビルドした拡張を専用のChromium profileにロードする。
テストごとにprofileを作成し、失敗時もbrowser providerのreleaseで削除する。
内部stateの設定やブラウザ内の自己検証コードは使わず、画面上の操作とassertionをrunnerに記録する。

```sh
mise exec -- bun run test:e2e
```

操作用モデルは Gemma 4 を固定し、mise + age の `CF_AI_ACCESS_URL` と既存の Access session を使う。
旧 OpenCode/Gateway key への fallback はない。[実行設計](../docs/e2e-execution.md)に責務・上限・認証境界を記録する。
GUIから起動してageの復号キーが渡らない場合は、Keychainから子プロセスへ渡す。

```sh
MISE_AGE_KEY="$(security find-generic-password -a "$USER" -s mise-age-key -w)" mise exec -- bun run test:e2e
```

Access のモデルへ送るのはこの専用profile内の合成データだけで、プロダクトの実校閲は実行しない。
telemetryは実行コマンドで無効化する。結果は `.e2e/report.json`、画像等は
`.e2e/artifacts/` に保存され、Gitには含めない。

初回は `mise install`、`mise exec -- bun install --frozen-lockfile`、
`mise exec -- bun run playwright install chromium` を実行する。model の vision/schema/tool call は
`mise exec -- bun run check:e2e:model` で実通信確認できる。ファイル選択は
`mise exec -- bun run test:e2e tests/model.e2e.ts`、wrapper の usage は
`mise exec -- bun scripts/run-e2e.ts --help`。同じ worktree の E2E は同時に起動しない（偽 API は port 18787）。

テスト内で対話ログインは始めない。session が無い・期限切れの場合は人間の terminal でログインする。
`--quiet` は JWT の stdout 表示を抑えるために必要である。

```sh
mise exec -- sh -c 'cloudflared access login --quiet "${CF_AI_ACCESS_URL:?CF_AI_ACCESS_URL is required}"'
mise exec -- bun run check:e2e:model
mise exec -- bun run test:e2e
mise exec -- bun run check:e2e:artifacts
```

`ACCESS_URL_MISSING/INVALID` は mise 設定・age 復号経路を確認する。
`ACCESS_SESSION_MISSING/INVALID/EXPIRED` と `ACCESS_DENIED`（401/403/redirect）はログインと policy を確認する。
`ACCESS_MODEL_HTTP`・`ACCESS_RESPONSE_INVALID`・`MODEL_CAPABILITY_FAILED` はモデル対応と Gateway を調べる。
HTML や assertion の緩和で成功にしない。`ACCESS_NETWORK_FAILED` は60秒の通信期限、
`ACCESS_REQUEST_LIMIT` は worker の60 HTTP requests（SDK retry を含む）の枠に達したことを示す。
`ACCESS_INPUT_LIMIT` は履歴・画像を含む request body の256 KiB上限に達したことを示す。
実 URL/domain・JWT をログに転記せず、秘密を含む `mise env` 出力も公開しない。

秘密不要の CI 相当部分は以下で実行できる。

```sh
mise exec -- bun run check:e2e
mise exec -- bun run test:e2e:transport
mise exec -- bun run test:e2e:offline
```

## 対象要件

| 要件 | テスト | 検証範囲 |
| --- | --- | --- |
| [note-inline-review: API keyの設定](../docs/prd/note-inline-review/prd.md#acceptance-criteria) | BYOK設定を保存し、再読み込み後も入力し直さず保存できる | モデルの永続化と、必須のキーを再入力せず再保存できること。secure fieldの値は読み取らず、キーの完全一致や校閲への送信は検証しない |
| [note-inline-review: 校閲の判定基準](../docs/prd/note-inline-review/prd.md#acceptance-criteria) | 校閲ルールを設定せず標準モードを保存できる | 規範設定・ファイル入力がなく、標準モードをそのまま保存・再読込できること |
| [multi-surface: 通常のcontenteditable](../docs/prd/multi-surface/research.md) | 執筆画面に実際の拡張の起動ボタンが現れる | 実拡張のhost要素と、画像での起動ボタンの表示。isolated worldのclosed shadow rootはDOM readerで読めないため、表示はvision付きのagent.assertで判定する |
| [multi-surface: 汎用判定と手動選択](../docs/prd/multi-surface/research.md) | 保存操作なしの本文、競合後の手動起動用表示、パネルの確定・不明・無し | 面積による検知と、競合の前後で起動ボタンの画像を確認する（ボタンのクリックは未確認）。公開tabs APIで合成画面を別タブに開き、実パネルの案内と実行ボタンを確認する。自動チェックの許可境界は共有ルールのテストで確認する |
| [multi-surface: 隣接ヘッダー](../docs/prd/multi-surface/research.md) | 本文の隣のヘッダーに保存操作がある執筆画面を検知する | host・起動ボタン画像・タイトルと本文の値 |
| [auto-review: 自動開始・差分送信](../docs/prd/auto-review/prd.md#acceptance-criteria) | 本文を開くと自動で校閲され、編集の停止で変わった段落だけを再送する | 偽 API の初回2ブロックとtoken、編集後1ブロックと本文値、FAB リングの画像 |
| [auto-review: 一時停止・再開](../docs/prd/auto-review/prd.md#acceptance-criteria) | パネルから自動校閲を一時停止・再開できる。止めている間は送信しない | 自己編集を含む停止窓で送信増分なし→再開後の段落 index と本文値 |
| 今回の Access 操作要件 | Accessモデルが設定を保存し、保存状態が再読み込み後も残る | 合成 BYOK を先に保存→実モデルで標準へ変更・保存→実際の status→reload 後の標準 radio と保存可否 |
| 今回の vision の負例 | 編集領域のない画面には起動ボタンが表示されない | host 不在と、起動ボタンが無い画像の判定 |

report の `titlePath` をテスト名に対応させる。各 attempt の `steps` が操作と assertion、
`artifacts` が screenshot/trace の参照である。`agent.act` の成功だけで完了せず、実際の status と reload 後の値を確認する。

`model` tag の6件は実モデルが必要。CI/local offline の4件は BYOK 設定、標準設定、パネルの確定・不明・無し、
一時停止・再開である。パネルは `sidepanel.html` をタブで開く接続であり、実 side pane の開閉とは区別する。

## 未確認範囲

note等の認証済み編集画面、side paneの開閉、実際の校閲・事実確認・抑制、指摘の適用・undo、
文体・読みやすさの実モデル品質、Firefox、ストア公開は検証しない。設定画面と起動ボタンの成功で
PRD全体のQA完了を判断しない。

旧QAのsurface検証マトリクスは、利用者の指示に従って全て廃止した。今回の汎用判定の変更に必要な合成画面だけを追加した。
コメント除外・readonly・iframe・適用・undo等のケースは、新E2Eへ移植していない。
起動ボタンの判定は形・位置・表示の有無を対象とし、配色や細かなピクセル一致を要求しない。
失敗時はtraceとスクリーンショットを確認し、再試行だけで成功扱いにはしない。

GitHub Actions の `E2E deterministic` は PR、main push、workflow_dispatch でモデル不要部分を実行する。
`model` tag を明示的に除外し、誤って agent を呼べばモデル未設定として失敗する。Access の個人 session は CI に配布しない。
CI の緑は実モデル操作や実校閲の成功を示さない。現在 head の実モデル QA はローカルで別に記録する。

artifact audit は ZIP 内も読み、接続先・既知の key・age 復号キー・JWT を検査する。文字列検査は画像内容を理解しないため、
専用 profile と環境変数の分離も維持する。公開前に秘密除外を確認する。次の実行で artifacts が消えるため失敗の調査・退避を先に行う。
profile の削除ログ・port 解放を確認し、強制終了で残った場合はこの run の残存だけを処理する。
[検証記録](../docs/e2e-validation.md)に今回の成功・失敗と境界を残す。
