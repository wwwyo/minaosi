# 原稿の校閲

「見直す」から原稿を校閲し、完了または失敗を画面で確認する。状態: **source-derived, not live-verified**。このinitでは全entrypointを未実行。過去の固定応答は実AI完了の証拠に数えない。

## Sub-features

- `review.1`: ローカルOpenCode BYOKで校閲し、進行表示から結果へ移る。
- `review.2`: 接続元未許可の失敗を表示し、閉じ直しと再読み込み後の状態を観察する。
- `review.3`: 校閲だけでは本文を書き換えず、執筆中の入力・選択を妨げない。

## How to get to it (user POV)

- note原稿の指摘paneを開き「見直す」を押す。
- エラー後にpaneを閉じて開く。保存済みテスト原稿を再読み込みする。

## Driving it with Orca / Computer Use

Preconditions:

- 共通Launchと`doctor-ui`成功。合成原稿の本文を記録済み。
- `review.1`は当runのOrigin許可、OpenCodeのテスト用キー、BYOKモデル`space-bunny-free`が必要。送信先はローカルWorker経由のOpenCodeテスト利用に限定する。
- `review.2`は別runでOriginを未許可にして起動する。既存サーバーの設定を変更して再現しない。

- **校閲開始 (`review.1`, pane「見直す」)。** 最新AXのrunを`await ui.click(run); await ui.getAXState();`。「原稿を見直しています…」から指摘カードまたは「指摘はありません」へ移ることを観察し、操作と結果を保存。Workerログもstatusのみ保存する。0件の結果は校閲完了だけを証明し、適用のcoverageには使わない。
- **本文・焦点 (`review.3`, paneから開始した校閲)。** 開始前に本文の末尾で入力位置を決め、開始後は最新bodyをクリックして`await ui.paste(' QA追記', {format:'text'}); await ui.getAXState();`。入力先、本文、selectionを確認する。校閲結果が来ても勝手な置換がないこと、入力中にcaretが別箇所へ移らないことを観察する。操作の途中結果も保存する。
- **403後の状態 (`review.2`, 未許可Originのpane)。** 新runの合成原稿で最新runをクリックしてAXを取得。「見直しが完了しませんでした」「許可されていない接続元です」を確認。最新closePaneとfabを使い`await ui.click(closePane); await ui.getAXState(); await ui.click(fab); await ui.getAXState();`。エラーと「見直す」の有無を記録。`await ui.pressKey('super+r'); await ui.getAXState();`後の状態も記録する。

## Gotchas

- 失敗後の再実行UIは前回の課題。現在の意図がspec/testで確定しなければ、観測を報告してblockedとし、期待値を推測して合否を決めない。
- 成功後に「見直す」がないことだけを回帰と判定しない。再読み込み前にはnoteの保存状態と破棄確認を読む。
- OpenCodeローカル経路は事実指摘・出典の検証に使わない。標準モード、Gateway、実際の事実指摘は別のtest環境と設定が必要で、このinitでは未実行。
- 秘密やサービス未設定による未完了はoperational blocker。キーを捏造したりhandlerを差し替えたりして完了扱いにしない。
