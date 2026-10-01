# 指摘pane

noteの原稿と同じウィンドウの独立したpaneで指摘を見られる。状態: **source-derived, not live-verified**。このinitでは以下の全entrypointを未実行。

## Sub-features

- `panel.1`: note右下のボタンでpaneを開閉する。
- `panel.2`: ブラウザの拡張アイコンからpaneが開く。
- `panel.3`: 対象外タブとnote編集タブを切り替えたとき、表示が対象タブに追従する。

## How to get to it (user POV)

- `https://editor.note.com/`からテスト原稿を開き、「指摘paneを開く」を押す。
- ブラウザのツールバーのminaosi拡張アイコンを押す。
- paneを開いたまま、`about:blank`とnote原稿タブを切り替える。note編集タブを再読み込みする。

## Driving it with Orca / Computer Use

Preconditions:

- 共通Launchと`doctor-ui`成功。テストアカウントの合成原稿がある。
- 各indexは最新AXから取得。タイトル/本文と現在の選択範囲を操作前に記録する。

- **右下で開閉 (`panel.1`, noteボタン)。** `await ui.click(fab); await ui.getAXState();`。role/name「指摘paneを開く」に一致する`fab`を使う。ブラウザ側の独立paneに「未対応」「適用済み」「削除」が現れ、本文が変わっていないことを記録する。最新AXからfabを取り直してもう一度clickするとpaneが閉じ、さらにclickで開くことを確認する。
- **アイコンから開く (`panel.2`, toolbar)。** paneの閉じるcontrolの`closePane`で`await ui.click(closePane); await ui.getAXState();`、最新AXのminaosiアイコン`toolbarIcon`で`await ui.click(toolbarIcon); await ui.getAXState();`。同じpaneが開く。アイコンが隠れていれば拡張メニュー内のminaosiを使い、そのentrypointを記録する。
- **対象タブに追従 (`panel.3`, tab切替)。** 専用browserで`await ui.pressKey('super+t'); await ui.typeText('about:blank'); await ui.pressKey('Return'); await ui.getAXState();`。「noteの原稿編集画面を開いてください」を確認。最新AXのnoteタブ`noteTab`で`await ui.click(noteTab); await ui.getAXState();`。note側の初期状態またはそのタブの指摘に戻る。`await ui.pressKey('super+r'); await ui.getAXState();`後も再接続を観察する。未保存破棄確認が出たら内容を確認し、保存済みの合成原稿だけを再読み込みする。

## Gotchas

- paneを閉じることと校閲状態の初期化は同じではない。閉じて開いただけで再実行できるとは期待しない。
- 別原稿の指摘が残らないことを確認する。新しいタブの表示だけでは元のタブの再接続を証明しない。
- Firefoxのsidebarは別の未検証entrypoint。このChrome手順の成功で代用しない。
