---
name: qa-minaosi
description: "minaosiのnote用ブラウザ拡張とローカル校閲APIを、隔離した環境で実操作して検証する。パネル、接続設定、校閲、適用・復元、失敗時の挙動をQAするときに使う。"
---

# minaosi QA

状態: **draft**。2026-10-01に`agent-qa init`で作成。`service.1`〜`service.4`は実際のcf/workerdでsmoke確認済み。それ以外は **source-derived, not live-verified**。WXTの隔離起動・拡張ビルドも確認したが、ブラウザ操作を証明するものではない。すべてのrecipeを実操作するまでdraftを外さない。

主対象はChromeのnote編集画面と独立したサイドパネル。副対象はオプション画面とHTTP API。Firefoxのビルド成功はFirefoxでの実操作確認に数えない。

## Launch

repoルートから実行する。依存関係が入っていることが前提。未導入ならrepoのセットアップに従う。QAを理由に依存の更新やプロダクトの修正はしない。

```sh
mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts prepare qa-20261001-01
orca terminal create --worktree current --title 'minaosi QA API' --command 'mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts api qa-20261001-01' --json
```

以降の`qa-20261001-01`はこのrun-idを使う。再実行では新しいIDを指定する。既存の証拠は上書きしない。

`prepare`は現在のソースのコピーとビルド・Worker状態を専用の一時ディレクトリに置く。依存は既存の`node_modules`を参照し、個人の`.env`、`.dev.vars`、ブラウザプロファイルはコピーしない。ソースのHEADと変更ファイル一覧を証拠に記録する。コピー中に対象ソースが変わった場合は新しいrunでやり直す。

証拠は`.agent/qa/runs/<run-id>/`、実行用ディレクトリはその中の`runtime.path`。APIは`http://127.0.0.1:18787`、WXTは`http://127.0.0.1:13011`。占有されていたら他のinstanceを操作せず、起動前に当runの`ports.json`を空きポートへ変更する。通常の8787や既存のブラウザには接続しない。

作成応答のterminal handleを`api-terminal.json`として証拠に保存する。`orca terminal read --terminal <作成したhandle> --limit 150 --json`で`Ready on http://127.0.0.1:18787`相当のログを確認してからDoctorへ進む。入力受付だけで起動済みと判断しない。

UI検証では、同じrunのAPIを起動した後に次も起動する。

```sh
orca terminal create --worktree current --title 'minaosi QA WXT' --command 'mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts web qa-20261001-01' --json
```

`web-terminal.json`にhandleを記録する。WXT標準の開発サーバーAPIを使い、ブラウザの自動起動だけを無効にする。build完了と`runtime.path`配下の`.output/chrome-mv3-dev/manifest.json`を確認する。

拡張をロードできる、公式配布のChrome for Testingが既にインストールされている場合のみ、`MINAOSI_QA_CHROME`にその実行ファイルの絶対パスを指定して次をOrca terminalで起動する。パスは秘密ではない。未導入ならUI検証はoperational blockerとして残し、個人Chromeで代用しない。

```sh
orca terminal create --worktree current --title 'minaosi QA browser' --command 'mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts browser qa-20261001-01' --json
```

`browser-terminal.json`にhandleを記録する。専用の`chrome-profile`に開発拡張をロードし、`minaosi QA <run-id>`というタイトルの開始ページを開く。このbrowser起動recipeは未実操作。Orca内蔵ブラウザではChrome拡張をロードできないため、ここだけ外部ブラウザを使う。操作はbundled Computer Useの`cua_repl`から行う。

noteは明示的なテスト用アカウントと合成原稿のみ。テスト用アカウントが使えなければnoteのrecipeはblocked。既存の個人下書きや以前のQAで残った個人Chromeのinstanceを再利用しない。公開・購入・第三者への通知はしない。

## Doctor

APIの最初のdrive前と失敗後に実行する。

```sh
mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts doctor qa-20261001-01
```

listenしているPIDが当runのlauncherの子孫であることと、`GET /health`が200かつ`ok:true`を返すことを確認し、応答と所有確認を保存する。`configured`はGateway設定の有無だけであり、標準モード・OpenCode・DO・実AIの疎通は証明しない。`configured:false`でもHTTPの拒否応答は検証できる。

UIのdrive前には次を実行する。

```sh
mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts doctor-ui qa-20261001-01
```

API所有確認に加え、WXTのlisten PID、minaosiのoptions/sidepanelを含むmanifest、専用profileのbrowser processの所有を確認する。その後、Computer Useの最新AXで対象ウィンドウとテストアカウントの編集画面を確認する。API用doctorだけでUIを検証済みにしない。

拡張IDは当runの`chrome://extensions`で取得する。UIから校閲する場合は、その拡張Originを`ALLOWED_ORIGINS`としてmiseからAPIへ渡して再起動する。Originも秘密の管理方法に従い、平文の`.env`を新設しない。OpenCodeの実校閲にはmise管理の`OPENCODE_API_KEY`と、オプションでのBYOK登録が必要。キーがなければ`review.1`はblocked。開発QAにAnthropic/OpenAIの実キーを代用しない。

## Drive

[feature map](features/README.md)から対象を選ぶ。APIのsmokeは次の実HTTP経路を使う。テスト専用endpointや差し替えたhandlerは使わない。

```sh
mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts service qa-20261001-01
```

UIはComputer Useのドキュメントを読み、当runのChrome for Testingを`cua.getApp`で選ぶ。appに複数ウィンドウがある場合は`minaosi QA <run-id>`の開始ページを持つウィンドウを確認して選ぶ。識別できなければblocked。既存personal browserのtabを選ばない。

```js
let ui = await cua.getApp('Google Chrome for Testing');
await ui.getAXState();
```

featureファイル内の`fab`、`body`、`apply`などは、直前のAXから対象のrole/nameに一致する**最新の数値index**を取得した変数。固定値を書き残さない。各操作後に`await ui.getAXState()`で結果を観察する。メニューの日本語/英語は実際のラベルを確認する。ブラウザの権限検証・セキュリティ警告で拒否されたら迂回しない。

共通の合成原稿:

```text
これはQA用の文章です。誤字を確認するため、こんにちわと書きます。
同じ表現を繰り返します。確認を確認します。
```

本文をクリックして`await ui.paste(<上記の原稿>, {format:'text'})`で入力する。タイトルは`minaosi QA <run-id>`とする。noteには自動保存があるため、破棄の確認だけで「保存されていない」と判断しない。実AIの指摘は不定なので、対象文字列・変更前後・指摘文を観察してから操作する。指摘を内部setterで作ってcoverageを埋めない。

## Evidence

- 証拠は`.agent/qa/runs/<run-id>/`へ保存する。各artifactにfeature ID、sub-feature ID、entrypointを記録する。最終画面だけでなく、操作前・実行したaction・操作後の状態を残す。
- HTTP helperは要求のURL/メソッド/合成入力と、status/header/bodyを別々に保存する。UIはAXの出力を確認・必要箇所を編集してから`<sub-feature>-<entrypoint>-before.txt`、`-action.txt`、`-after.txt`として保存する。スクリーンショットがtool出力にあるだけではディスク上の証拠に数えない。
- 原稿の実変化、フィルターの件数、再読み込み後の設定を検証する。保存toastだけで永続化を証明しない。
- token、cookie、APIキー、個人の原稿・アカウント情報は保存しない。raw HAR、storage dump、環境変数一覧は採取しない。ログやAXは秘匿情報がないと確認してから保存する。キー入力中の画面は証拠に使わない。
- 既存instanceをdriveしない。独立したport/profile/data dirを使えない場合はblocked。起動したPIDとOrca terminal handleを保存し、他人のinstanceを停止しない。
- 外部送信は明示的なテスト環境だけで行う。支払い、公開、第三者への通知などの不可逆な変更は別途の明示承認が必要。原稿は合成データを使い、実AIの検証でも送信先・利用条件が確認できるsandbox/testアカウントを使う。
- driveに失敗したら診断を保存→Doctor→自分のinstanceをCleanup→証拠の残存確認→新runでLaunch/Doctor→1回だけ再試行する。再度失敗したらblocked。修正のためにプロダクトを書き換えない。
- 未到達は、試したURL/command/操作と具体的に欠けた権限・キー・テストアカウント等を記録して`verified-unreachable`とする。この結果は常にblocked。未実行のentrypointはfeatureごとに全件列挙し、別entrypointの成功で埋めない。
- 環境・認証・キー・外部サービス停止はoperational blocker。product gapとは分ける。意図した挙動がspec/testから確定できなければ推測で不具合判定しない。
- dry-runを追加する場合は、network/writeが実際に起きていないことも観察する。今回のrecipeにはdry-runはない。

## Cleanup

1. UIで作った合成原稿の変更を戻す。noteのテスト下書きは通常の可逆な削除操作で片付け、結果を確認する。削除手順が不明・権限不足なら残ったテスト下書きがあることを記録する。既存下書きには触らない。
2. ログを確認してから秘匿情報を除き保存する。`api-terminal.json`等に記録した**自分のhandleだけ**を`orca terminal close --terminal <handle> --json`で閉じる。`ptyKilled:true`を確認する。bulk close、`pkill`、名前によるkillはしない。
3. 次を実行し、launcher停止、port解放、専用runtime削除、証拠の残存を確認する。

```sh
mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts cleanup qa-20261001-01
```

helperは停止を確認するだけで、既存processをkillしない。別instanceがそのportを使い始めた場合も勝手に止めず、所有関係を確認する。証拠を持つ`.agent/qa/runs/`は削除しない。browserに残る子processもprofileのpathと起動元で確認し、Orca closeで停止しなければ自分が起動したPIDだけを対象にする。

## Helpers

- `scripts/runtime.ts`: 実行権限あり。`mise exec -- bun .agents/skills/qa-minaosi/scripts/runtime.ts <command> <run-id>`。`prepare/api/web/browser/doctor/doctor-ui/service/cleanup`を提供する。
- `scripts/start-web.mjs`: 実行権限あり。`web`からNodeで呼ぶ。WXTのbrowser自動起動を止める検証用launcherで、プロダクトの校閲処理や状態を差し替えない。

smoke証拠: `.agent/qa/runs/init-20261001-retry/`。初期HEADは`b0ca6a557ca504cfa3a229ed3f6f78065037b09d`で、既存の未commit変更を含むコピーに対する確認。変更一覧は同runの`source-status.txt`を参照。WXTの初回起動はmacOSの`/var`と`/private/var`による再ビルドループを観察したため、QA用runtimeのpathを正規化し、Cleanup後の新runで再確認した。前回の操作と検証の限界は[今回のQAから引き継いだ手順](references/previous-qa.md)に記録した。
