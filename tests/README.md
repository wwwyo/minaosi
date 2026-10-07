# E2E

共通の `e2e` skill に従い、ビルドした拡張を専用のChromium profileにロードする。
テストごとにprofileを作成し、失敗時もbrowser providerのreleaseで削除する。
内部stateの設定やブラウザ内の自己検証コードは使わず、画面上の操作とassertionをrunnerに記録する。

```sh
mise exec -- bun run test:e2e
```

操作用モデルはmise + ageの `OPENCODE_API_KEY` と `OPENCODE_E2E_MODEL` を使う。
GUIから起動してageの復号キーが渡らない場合は、Keychainから子プロセスへ渡す。

```sh
MISE_AGE_KEY="$(security find-generic-password -a "$USER" -s mise-age-key -w)" mise exec -- bun run test:e2e
```

OpenCode Goへ送るのはこの専用profile内の合成データだけで、プロダクトの校閲は実行しない。
telemetryは実行コマンドで無効化する。結果は `.e2e/report.json`、画像等は
`.e2e/artifacts/` に保存され、Gitには含めない。

## 対象要件

| 要件 | テスト | 検証範囲 |
| --- | --- | --- |
| [note-inline-review: API keyの設定](../docs/prd/note-inline-review/prd.md#acceptance-criteria) | BYOK設定を保存し、再読み込み後も入力し直さず保存できる | モデルの永続化と、必須のキーを再入力せず再保存できること。secure fieldの値は読み取らず、キーの完全一致や校閲への送信は検証しない |
| [note-inline-review: 校閲の判定基準](../docs/prd/note-inline-review/prd.md#acceptance-criteria) | 校閲ルールを設定せず標準モードを保存できる | 規範設定・ファイル入力がなく、標準モードをそのまま保存・再読込できること |
| [multi-surface: 通常のcontenteditable](../docs/prd/multi-surface/research.md) | 執筆画面に実際の拡張の起動ボタンが現れる | 実拡張のhost要素と、画像での起動ボタンの表示。isolated worldのclosed shadow rootはDOM readerで読めないため、表示はvision付きのagent.assertで判定する |

| [multi-surface: 汎用判定と手動選択](../docs/prd/multi-surface/research.md) | 保存操作なしの本文、競合後の手動選択、パネルの確定・不明・無し | 実拡張で面積による検知、競合時の起動ボタンの撤去、クリックによる再表示を確認する。公開tabs APIで合成画面を別タブに開き、実パネルの案内と実行ボタンを確認する。自動チェックの許可境界は共有ルールのテストで確認する |

## 未確認範囲

note等の認証済み編集画面、side paneの開閉、実際の校閲・事実確認・抑制、指摘の適用・undo、
文体・読みやすさの実モデル品質、Firefox、ストア公開は検証しない。設定画面と起動ボタンの成功で
PRD全体のQA完了を判断しない。

旧QAのsurface検証マトリクスは、利用者の指示に従って全て廃止した。今回の汎用判定の変更に必要な合成画面だけを追加した。
コメント除外・readonly・iframe・適用・undo等のケースは、新E2Eへ移植していない。
起動ボタンの判定は形・位置・表示の有無を対象とし、配色や細かなピクセル一致を要求しない。
失敗時はtraceとスクリーンショットを確認し、再試行だけで成功扱いにはしない。

このセットアップの実行対象はローカル環境である。GitHub Actionsでの実行は未設定。
