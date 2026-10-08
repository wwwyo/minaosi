# auto-review の実装設計

[PRD](./prd.md) の実装上の判断を記録する。2026-10-07。

## 起動の判断（AI なし）

ルールだけで起動する。Clef / TypeSafe Jev などの意味判断は、この構成で十分な精度が出るため採用しない。

- 確定した本文を検知した時点で一度だけ全文を送る（本文が空なら送らない）。
- 本文への DOM 変更（IME 変換中の見かけ上の編集を含む）を MutationObserver で拾い、最後の変更から 4 秒静かなら再度送る。変換中（`compositionstart`〜`compositionend`）はタイマーを進めない。
- 送信と送信の間に最低 10 秒の間隔を空ける。初回送信は間隔制限をかけない。
- 校閲の実行中に届いた編集は、実行が終わってから改めて差分を取って送る（キューは1件だけ）。
- 一時停止は content script のメモリ上の状態で、ページ再読込で元に戻る。

## 送る範囲

小さな編集のたびに全文は送らない。直前に送信したブロック本文を要素参照つきで保持し、再送時に `extractBlocks` の結果と比較して、要素が新しいか本文が変わったブロックだけを送る。API の `blocks` は任意の部分集合を受け取り、`index` は文書内の位置を保つため、API 側の変更は不要。

段落の挿入・削除で index がずれても、差分判定は要素の同一性で行う。全文未送信・全ブロック空のときは送らずに記録だけを進める（空原稿で起動しない）。

## 指摘のマージ

応答は送ったブロックの指摘だけを最新として扱う。

- 送ったブロックの指摘は新しい結果で置き換える。
- 送らなかったブロックの指摘（未対応・適用済み・削除と、それらの match の位置・適用状態）はそのまま残す。
- 本文から外れた要素に紐づく指摘は消す。
- 変更したブロックで、消える指摘と同じ種類・表題・対象文字列の指摘が同じ箇所（同じ要素か、ずれ後も同じ block 番号）に再び報告されたときは、書き手の「削除」判断を引き継ぐ（適用済みは本文が直っているため再報告されない前提で、削除だけを引き継ぐ）。別ブロックへの同名の報告は新しい指摘として扱う。
- `factCheck.sourceCheckedBlocks` は過去応答との和集合を保持する。部分的な確認を文書全体の確認と扱わない。index がずれるため内部は段落要素の参照で持ち、表示時に現在の番号へ写す。

## 人間性の確認（Turnstile）

`POST /review` は標準モード・BYOK の両方で Turnstile トークンを要求する。パネルが閉じている間の自動起動にもトークンが要るため、widget を載せる場所を増やす。

- Chrome MV3: `offscreen` document（`entrypoints/offscreen/`）を起きている間だけ作り、そこに `/turnstile` の iframe を載せる。background の service worker が `minaosi:acquire-turnstile` を受けて offscreen へ転送し、トークンを返す。
- Firefox MV3: background が event page で DOM を持つため、offscreen 相当として background 自身が iframe を載せる（`typeof document` で分岐）。
- widget が対話を要求した（`interactive` イベント）場合は、非表示の文書では応えられないため失敗として返す。content script 側は `blocked` 状態にし、パネルを開いたときに「確認して見直す」ボタンを出すだけに留める（FAB への通知・バッジは出さない）。手動の「見直す」経路は従来どおり side panel 内で対話可能な widget を使う。
- widget は同時に1件しかトークンを出せないため、background 側で要求を直列化する（複数タブからの同時要求は順に捌く）。差分が無い発火ではトークンを取らない。

## 消化率リング

`docs/prd/auto-review/prototype/handling-ring.html` に従う。

- 既存 FAB に `track`（`--color-line`）と `fill`（`--color-ink`）の SVG 円を重ね、ロゴは中央のまま。1px の border はリングに置き換える。
- 消化率 = `対応済み（適用済み＋削除）/ 指摘総数`。閲覧・選択は数えない。
- `指摘0件`・`初回待機`・`全件対応` は fill が全周する同じ見え方（`stroke-dasharray: none`）。0/N は fill を消して track だけにする。`pathLength="100"` で比率を直接 dashoffset に写す。
- `aria-label` に「N件中M件対応済み / 指摘はありません」を含める（見本と同じ）。tooltip・点滅・ドットは足さない。

## パネルの一時停止・再開

パネル下部に常駐の `auto` 行を置く（確定した本文があるときだけ表示）。

- 動作中: 「自動校閲中」＋「一時停止」ボタン
- 一時停止中: 「自動校閲は一時停止中」＋「再開」ボタン
- 確認待ち（blocked）: 「校閲を続けるには人の確認が必要です」＋「確認して見直す」ボタン（通常の手動経路で対話する）

`PanelCommand` に `{action:'auto', enabled}` を追加し、panel → content script で状態を変える。手動の「見直す」は一時停止中・確認待ちでも実行できる。

## 検証の組み立て

- 差分・マージは DOM に依存しない純粋関数として切り出して単体テストする（`auto-review.test.ts`）。
- E2E は `wxt build --mode development` と固定ポートの偽 `/review`・`/turnstile`（`tests/support/site.ts` 内の第2サーバー）で、実拡張の自動起動→部分送信→指摘表示→一時停止を合成画面で確かめる。実 AI・実 Turnstile・実サービス画面の確認は E2E 対象外とし、別途ローカルの `api:dev` 系統で人手確認する。
