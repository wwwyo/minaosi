# prototype: 指摘提示 UI（採用形）

`notes.html` + `tokens.css` は解の形を決めるために触った最終版。ローカルで静的に開くだけで動く。

```bash
cd docs/prd/note-inline-review/prototype && python3 -m http.server 8317
# http://localhost:8317/notes.html
```

## この形で確定したこと

- 右サイドパネル（`minaosi` ブランド）に指摘カードを一覧。タブは 未対応 / 適用済み / 削除 の3つ（「すべて」は持たない）
- 修正案は本文中に `~~原文~~ 修正案` の差分で直接重ねる。適用は書き手の明示操作のみ
- 選択中の指摘は本文側の修正範囲だけをリングで囲う（段落全体は囲わない、下線装飾は使わない）
- 適用済みカードの選択時は本文に差分プレビューを出し、「元に戻す」で何が戻るかを見せる
- 抑制（rubric 判定で出さない）指摘は UI のどこにも現れない
- 複数箇所の指摘は箇所ごとに部分適用できる
- パネルはロゴ+» のトグルで畳める。閉じても状態は保持され、再オープンで再実行は要らない

## 棄却した方向

`.agent/prototypes/finding-display/` 側の `index.html`（Inline/Margin/Panel/Walkthrough の4方向比較）と `round2.html`（Notes/Redline/Sections の3方向比較）はコピーしていない。再現したければ同 dir を `python3 -m http.server` で開く（`.agent` は gitignore 内のため repo には残らない）。
