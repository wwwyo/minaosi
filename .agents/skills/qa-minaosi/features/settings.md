# 校閲の接続設定

標準サービスか自分のキーかを選び、モデルに対応する設定を保存する。状態: **source-derived, not live-verified**。このinitでは全entrypointを未実行。

## Sub-features

- `settings.1`: 標準モードを保存し、開き直して保持を確認する。
- `settings.2`: BYOKのモデル・キーを保存し、モデル系列を切り替えてキーが混ざらないことを確認する。
- `settings.3`: 判定できないモデルの保存を拒否する。

## How to get to it (user POV)

- browserのminaosi拡張メニューから「オプション」を開く。
- 当runの拡張IDを使った`chrome-extension://<当runのID>/options.html`を開く。

## Driving it with Orca / Computer Use

Preconditions:

- 共通Launchと`doctor-ui`成功。オプションの「読み込み中…」が消えている。
- 保存の検証だけならキーは`qa-opencode-invalid` / `qa-openai-invalid`というダミーを使う。これらで校閲を実行しない。実キー入力は証拠に残さない。

- **標準を保存 (`settings.1`, オプション)。** 最新AXの「minaosiの標準」radio=`standard`と「保存する」=`save`に対し`await ui.click(standard); await ui.getAXState(); await ui.click(save); await ui.getAXState();`。キー欄が隠れることを記録。「保存しました」確認後`await ui.pressKey('super+r'); await ui.getAXState();`でradioの選択が保持されることを確認する。
- **BYOKを保存 (`settings.2`, オプション)。** 「自分のAPIキー」=`byok`を`await ui.click(byok); await ui.getAXState();`。ラベル「モデル」=`model`と「APIキー」=`key`へ`await ui.setValue(model, 'space-bunny-free'); await ui.getAXState(); await ui.setValue(key, 'qa-opencode-invalid'); await ui.getAXState();`。最新のsaveをクリックし、再読み込み後のモデルとBYOK選択を確認する。キーの入力欄が非空であることは秘密を記録せず確認する。
- **系列を切替 (`settings.2`, モデル欄)。** 最新modelへ`await ui.setValue(model, 'gpt-5.4-mini'); await ui.getAXState();`。別系列のキー欄へ切り替わり、OpenCodeの値を引き継がないことを確認。`qa-openai-invalid`を入力・保存・再読み込み後、`space-bunny-free`へ戻し、OpenCode側のダミー設定が保持されることを確認する。変更するたびに最新AXからindexを取り直す。
- **未知モデルを拒否 (`settings.3`, モデル欄)。** `await ui.setValue(model, 'unknown-qa-model'); await ui.getAXState();`、最新saveをクリック。モデルの入力エラーが出ること、再読み込みで最後に正常保存したモデルが残ることを確認する。

## Gotchas

- 現在のUIはモデルIDから接続先を判定する。過去のprovider選択UIを探さない。
- 候補リストは表示名と保存値が違う場合がある。実際の入力値を確認する。
- AXやstorageを丸ごと保存するとキーが混入し得る。証拠はradio、モデル、statusと秘匿したキーの有無だけにする。
- メニュー経由とURL直開きは別entrypoint。片方だけ実施したらもう片方を未実行として列挙する。
