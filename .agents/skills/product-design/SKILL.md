---
name: product-design
description: minaosi の UI/UX 判断と視覚値の正本。校閲 chrome（パネル・カード・本文マーク・修正案）を組む・見直す・文言を決めるときに使う。値の正本は repo root の design.md、ここには語彙表と判断原則だけを置く。
---

# product-design — minaosi

執筆面（surface）の上に重ねる校閲 UI の設計規約。判断原則と、design.md の変数・component の語彙表を持つ。design.md 本体は読まず、この表だけを見て当てる。

## 判断原則

- **chrome はモノクロで沈黙させる**。色は「修正案（suggestion）」と「選択中の指摘（selection）」だけに使う — `--color-accent*` をそれ以外の場面に使わない。種類（誤字/事実/…）を色で区別しない。理由: 指摘一覧を虹色にすると書き手の視線が散り、校閲ツールが「もう一人の編集者」ではなくノイズになる
- **本文は host のもの**。我々が書くのは chrome 文字だけ。小さい階調（10〜14px）で組み、本文タイポグラフィに踏み込まない
- **提案は挿入候補テキスト、操作は動詞ボタン**。`suggest-ins` はボタンらしくしない（枠・太字を付けない）。action のラベルはすべて動詞: 適用 / 削除 / 復元 / 元に戻す / 見直す
- **削除は静かに**。danger 色を使わない。取り消し線の `--color-strike` は修正案の「前」の文字列専用で、エラー色として流用しない
- **影は浮遊物だけ**。tooltip と FAB にのみ。パネルやカードは境界線で分ける
- **hover 補助 UI は候補の表示行が基準**。適用ボタンはホバーした候補の行の中央・直上に出す。明示改行と自動折り返しの両方で、各表示行を独立したアンカーにする。カーソルの X 座標には追従させない
- **選択は修正範囲リング**。選択中の指摘は修正対象の範囲だけを 1.5px の細いリング（`--color-ring`）で囲う。段落や文全体は囲わない。下線（点線/実線）で状態を表す装飾は使わない — 違いが判別しにくいため
- **フィルタは2つ**。状態タブは 未対応/対応済み。対応済みのカードに適用済み/削除を表示し、各カードで undo/復元できる。「すべて」は置かない
- **件数の行は置かない**。状態は未対応/対応済みのタブで切り替える

## 語彙表（design.md）

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
| `--color-primary` + `--color-on-primary` | 主操作（墨塗りボタン） |
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
| `.card-finding` (+ `.is-selected/.is-resolved`) | 指摘カード行 |
| `.card-finding-kind/-title/-reason/-source` | カード内部要素 |
| `.card-actions` `.icon-danger` | カード右上の適用/削除/undo |
| `.mark` `.block-mark` (+ `.is-selected`) | 本文上の指摘印（選択は範囲リング） |
| `.suggest` (+ `.is-selected`) `.suggest-del` `.suggest-ins` | 修正案（前/後テキストと選択リング） |
| `.filter-tabs` `.filter-tab` (+ `.is-on`) | 状態フィルタ |
| `.brand` `.brand-name` `.progress` | ヘッダー・件数表示 |

## 状態の語彙（UI 文言として）

- 指摘の状態: `open（未対応）` / `resolved（適用済み）` / `deleted（削除）`
- rubric で除外された指摘は UI に一切出さない（「文体規範で許容」等のラベルを立てない）
- 適用は人間の明示操作のみ。指摘カードの「適用」はその指摘の全箇所を、本文側の箇所ボタンは1箇所だけを適用する。全指摘を一度に適用する一括操作と自動適用は存在しない
- 複数出現の指摘は `fixes[]` で箇所ごとの修正案を持ち、個別適用できる

## tools

- `tools/brand-css-check.py` — 未定義 var と `--on-*`/`--*` ペアのコントラスト（WCAG AA 4.5）を検査。lint 合格は規約準拠の証明ではない（判断の正しさは原則と人間のレビューで担保する）

```bash
# repo root から
python3 .agents/skills/product-design/tools/brand-css-check.py design.md
```
