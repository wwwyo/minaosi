---
name: product-design
description: minaosi の UI/UX 判断と視覚値の正本。校閲 chrome（パネル・カード・本文マーク・修正案）を組む・見直す・文言を決めるときに使う。値の層は brand.css、ここには語彙表と判断原則だけを置く。
---

# product-design — minaosi

執筆面（surface）の上に重ねる校閲 UI の設計規約。判断原則と、brand.css の変数・クラスの語彙表を持つ。CSS 本体は読まず、この表だけを見て当てる。

## 判断原則

- **chrome はモノクロで沈黙させる**。色は「修正案（suggestion）」と「選択中の指摘（selection）」だけに使う — `--color-accent*` をそれ以外の場面に使わない。種類（誤字/事実/…）を色で区別しない。理由: 指摘一覧を虹色にすると書き手の視線が散り、校閲ツールが「もう一人の編集者」ではなくノイズになる
- **本文は host のもの**。我々が書くのは chrome 文字だけ。小さい階調（10〜14px）で組み、本文タイポグラフィに踏み込まない
- **提案は挿入候補テキスト、操作は動詞ボタン**。`suggest-ins` はボタンらしくしない（枠・太字を付けない）。action のラベルはすべて動詞: 適用 / 削除 / 復元 / 元に戻す / 再実行
- **削除は静かに**。danger 色を使わない。取り消し線の `--color-strike` は修正案の「前」の文字列専用で、エラー色として流用しない
- **影は浮遊物だけ**。tooltip と FAB にのみ。パネルやカードは境界線で分ける
- **選択は段落リング**。選択中の指摘はブロック全体を 1.5px の細いリングで囲う。マーク自体に太い枠を付けない
- **フィルタは3つまで**。状態タブは 未対応/適用済み/削除。「すべて」は置かない（削除・適用済みは各タブ内で undo/復元できる）
- **進捗は非ゼロのみ**。0件の状態と「計」は出さない

## 語彙表（brand.css）

| 名前 | 用途 |
| :--- | :--- |
| `--color-bg-canvas` | chrome が載る基底面 |
| `--color-bg-panel` | サイドパネル背景 |
| `--color-bg-surface` | カード・ボタン等の浮いた面 |
| `--color-bg-hover` | hover・選択行の背景 |
| `--color-ink` | 一次テキスト（墨色） |
| `--color-ink-sub` | 二次テキスト（理由・メタ） |
| `--color-ink-mute` | 三次テキスト（件数・静かな icon） |
| `--color-line` / `--color-line-strong` | 区切り線 / 操作枠線 |
| `--color-primary` + `--color-on-primary` | 主操作（墨塗りボタン・FAB・tooltip） |
| `--color-accent` / `-ink` / `-tint` + `--color-on-accent` | 修正案・選択中だけ |
| `--color-strike` | 修正案の「前」の取り消し線のみ |
| `--color-ring` / `--color-flash` | 選択リング / アンカーフラッシュ |
| `--font-ui` | 和文ゴシック系の font-family（和→英→generic） |
| `--font-size-micro/caption/small/body/brand` | 10 / 11.5 / 12.5 / 13 / 14px |
| `--radius-sm/md/full` | 3px / 5px / pill |
| `--space-1..6` | 4〜24px |
| `--shadow-pop/fab/fab-hover` | tooltip / FAB の影のみ |
| `--ease-out` + `--dur-fast/med` | 150ms / 220ms |
| `.btn` `.btn-primary` `.btn-ghost` `.icon-btn` `.fab` | ボタン系 |
| `.card-finding` (+ `.is-selected/.is-resolved/.is-deleted`) | 指摘カード行 |
| `.card-finding-kind/-stat/-title/-reason/-source` | カード内部要素 |
| `.card-actions` `.icon-danger` | カード右上の適用/削除/undo |
| `.mark` `.block-mark` (+ `.is-selected`) `.block-ring` | 本文上の指摘印 |
| `.suggest-del` `.suggest-ins` | 修正案の前/後テキスト |
| `.filter-tabs` `.filter-tab` (+ `.is-on`) | 状態フィルタ |
| `.brand` `.brand-name` `.progress` | ヘッダー・件数表示 |

## 状態の語彙（UI 文言として）

- 指摘の状態: `open（未対応）` / `resolved（適用済み）` / `deleted（削除）`
- rubric で除外された指摘は UI に一切出さない（「文体規範で許容」等のラベルを立てない）
- 適用は1件ずつ人間が押す。一括適用・自動適用は存在しない
- 複数出現の指摘は `fixes[]` で箇所ごとの修正案を持ち、個別適用できる

## tools

- `tools/brand-css-check.py` — 未定義 var と `--on-*`/`--*` ペアのコントラスト（WCAG AA 4.5）を検査。lint 合格は規約準拠の証明ではない（判断の正しさは原則と人間のレビューで担保する）

```bash
python3 tools/brand-css-check.py brand.css
```
