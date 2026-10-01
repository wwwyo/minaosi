# 指摘の選択と修正

指摘を選び、書き手自身が適用・取り消し・削除・復元を決める。状態: **source-derived, not live-verified**。このinitでは全entrypointを未実行。前回の固定応答での操作は参考記録のみ。

## Sub-features

- `finding-actions.1`: カードまたは本文マークから指摘を選び、理由と対象を確認する。
- `finding-actions.2`: 修正案を適用し、元に戻す。
- `finding-actions.3`: 本文を変えずに指摘を削除し、復元する。
- `finding-actions.4`: 対象本文を手動編集した後に古い修正案が誤適用されない。

## How to get to it (user POV)

- paneの指摘カード、カードを選択した状態でのEnter/Space、note本文の指摘マーク。
- カードの「適用」「適用を元に戻す」「削除」「復元」ボタン。
- note本文の通常の編集操作。

## Driving it with Orca / Computer Use

Preconditions:

- 共通Launchと`doctor-ui`成功。実経路の校閲が完了し、置換案付きの指摘が1件以上ある。
- 対象指摘の元文字列=`before`、修正案=`after`、本文全文、初期件数を保存する。指摘が出なければ実施できない手順として記録する。

- **指摘を選ぶ (`finding-actions.1`, カード)。** 最新AXで該当するカード=`card`を取り`await ui.click(card); await ui.getAXState();`。理由が展開し、対象箇所が本文で強調されることを確認。本文マーク=`mark`がAXにあれば`await ui.click(mark); await ui.getAXState();`からの選択も記録する。AXにないマークは最新Screenshotで位置を確認してから操作する。カードにfocusを置き`await ui.pressKey('Return'); await ui.getAXState();`、`await ui.pressKey('space'); await ui.getAXState();`で選択が切り替わるか観察する。
- **適用と取消 (`finding-actions.2`, カードボタン)。** 最新「適用」=`apply`で`await ui.click(apply); await ui.getAXState();`。本文の対象がbeforeからafterへ変わり、他の本文が変わっていないことを確認。「適用済み」=`resolvedFilter`をクリックし、件数と指摘を確認。最新「適用を元に戻す」=`undo`で`await ui.click(undo); await ui.getAXState();`。本文がbeforeに戻り、「未対応」へ移ることを確認する。
- **削除と復元 (`finding-actions.3`, カードボタン)。** 未対応の該当カードで最新「削除」=`remove`へ`await ui.click(remove); await ui.getAXState();`。本文の文字はそのままで、削除件数が増えることを確認。「削除」filterへ移り、最新「復元」=`restore`で`await ui.click(restore); await ui.getAXState();`。未対応と本文マークが戻ることを確認する。filterとカードボタンの同名「削除」を取り違えない。
- **手動編集後の保護 (`finding-actions.4`, note本文)。** 最新bodyで`await ui.selectText(body, before); await ui.getAXState();`。選択範囲を確認してから`await ui.paste('QAで手動変更した文言', {format:'text'}); await ui.getAXState();`。対象が一致しなくなった旨の表示と「適用」の状態を確認し、手動変更が古いafterで上書きされないことを記録する。本文の変更が起きなかった操作はcoverageに数えない。

## Gotchas

- 同じ文字列が複数箇所にある場合は最新AXと前後の文脈で選択を限定する。caretだけを置いた操作を範囲選択として扱わない。
- 本文の自動保存と指摘のsession状態は別。適用取消は本文と件数の両方で確認する。
- キーボード、本文マーク、カードのclickは別entrypoint。未実行のものを必ず列挙する。
- 任意の固定指摘を内部注入しない。実AIで対象指摘が得られなければ、fixtureの不足としてblockedにする。
