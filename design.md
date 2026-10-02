# Design — minaosi

Locked design system。この repo の視覚値の正本。product-design skill（`.agents/skills/product-design/`）
はこれを参照する。値を変えるときはこのファイルだけを編集する。

## System

- Genre · editorial
- Theme · 中立グレーの面に、単一アクセント色（緑 = 編集者のペン）だけを機能に紐づける。色に意味を持たせるのは suggestion と selection の2箇所だけ
- Vibe · 編集面の客、静粛、素読み可能、一色の示唆、墨色の chrome、緑の校閲

## Tokens

```css
:root {
  /* Surfaces — 中立グレー。わずかに寒色を含む墨色体系 */
  --color-bg-canvas: oklch(99% 0.002 264);
  --color-bg-panel: oklch(97% 0.004 264);
  --color-bg-surface: oklch(100% 0 0);
  --color-bg-hover: oklch(95% 0.006 264);

  /* Ink — テキスト階調。ink-mute は panel 面上で AA 4.5 を確保済み */
  --color-ink: oklch(24% 0.02 264);
  --color-ink-sub: oklch(44% 0.02 264);
  --color-ink-mute: oklch(52% 0.02 264);

  /* Lines — カード・パネルは影ではなく境界線 */
  --color-line: oklch(87% 0.008 264);
  --color-line-strong: oklch(80% 0.01 264);

  /* Action — 主操作は墨の塗り（適用・見直す）。accent ではない */
  --color-primary: oklch(24% 0.02 264);
  --color-on-primary: oklch(100% 0 0);

  /* Accent — 修正案（suggestion）と選択中（selection）専用。他用途は禁止 */
  --color-accent: oklch(48% 0.13 155);
  --color-on-accent: oklch(100% 0 0);
  --color-accent-ink: oklch(43% 0.12 155);  /* 淡い面上の accent 文字 */
  --color-accent-tint: oklch(94.5% 0.03 155); /* 修正案チップ・選択リングの背景 */

  /* Strike — 修正案「前」の取り消し線専用。danger 色ではない */
  --color-strike: oklch(52% 0.07 20);

  /* Ring / flash — 選択リングと、アンカーへ一瞬出すフラッシュの縁 */
  --color-ring: var(--color-accent);
  --color-flash: oklch(24% 0.02 264 / 0.25);

  /* Typography — chrome は system stack。surface の書体に馴染ませる方針のため
     webfont は持たない（本文タイポグラフィは host のもので、踏み込まない） */
  --font-ui: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Segoe UI", sans-serif;
  --font-size-micro: 10px;   /* 種類ラベル */
  --font-size-caption: 11.5px; /* 進捗・フィルタ・出典 */
  --font-size-small: 12.5px;  /* 理由文 */
  --font-size-body: 13px;     /* カードタイトル・UI 本文 */
  --font-size-brand: 14px;    /* ワードマーク */
  --line-height-ui: 1.6;
  --letter-spacing-micro: 0.08em;
  --letter-spacing-brand: 0.04em;

  /* Shape — 角丸は2段＋丸。カードは角丸を持たない */
  --radius-sm: 3px;
  --radius-md: 5px;
  --radius-full: 999px;

  /* Spacing — 4 の倍数で 6 段 */
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;

  /* Elevation — 浮くのは tooltip と FAB のみ */
  --shadow-pop: 0 4px 14px oklch(0% 0 0 / 0.25);
  --shadow-fab: 0 2px 8px oklch(0% 0 0 / 0.18);
  --shadow-fab-hover: 0 4px 14px oklch(0% 0 0 / 0.24);

  /* Motion — 速い ease-out 一本 */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --dur-fast: 150ms;
  --dur-med: 220ms;
}
```

## Components

```css
/* 基盤 component の規約。実装は content script 側と prototype を見る */

/* .btn-primary（墨塗り）= 見直すの主操作。適用は白背景と境界線。
   副操作は .btn-ghost。
   icon-only は .icon-btn */
/* .fab = 白い --color-bg-surface に --color-ink のマーク。
   1px の --color-line-strong で境界を示し、影は付けない。
   hover でも色・境界・影・位置を変えない。クリックで pane を開閉する */
/* .card-finding = 指摘カード。区切り線で分け、選択時は左に墨バー。
   対応済みは --color-ink-mute で薄く表示し、適用済み・削除のラベルと復元操作を付ける。
   カード全体の透過は文字と操作のコントラストを落とすため使わない */
/* .mark / .suggest = 本文上の指摘印。選択中は修正範囲だけを 1.5px の
   --color-ring リングで囲う。段落・文全体は囲わない。下線による状態表現は禁止 */
/* .suggest-del（前）= --color-strike の取り消し線 / .suggest-ins（後）=
   --color-accent-ink 文字＋--color-accent-tint 背景。ボタン化しない */
/* .brand = logo mark + wordmark + 畳みシェブロンの単一クリックボタン */
/* 未対応は常に上へ並べる。対応済みは対応順で下へ積み、灰色見出しと eye で表示切替。
   既定は非表示、表示設定は拡張 pane の localStorage に保存する */
/* 状態件数の行は表示しない */
/* 適用 tooltip は白背景・墨色・1px の --color-line-strong。
   ホバーした候補の表示行の中央・直上に出し、影は付けない */
/* 候補は本文と同じ font・文字サイズ・行間で、取り消し線のすぐ右に行内表示する */
/* 本文の取り消し線・選択リングは、修正で変わる最小の範囲に限定する */
```

## Icons

- **Lucide**（ISC license）— 24px grid、stroke 2、round caps/joins。inline SVG として使い、小サイズ（11–14px 表示）はそのまま縮小する
- 現行対応: 適用 `check`、削除 `trash-2`、undo/復元 `undo-2`、対応済み表示 `eye` / `eye-off`、畳み `chevrons-right`、見直す `sparkles`、FAB `list-checks`
- 例外: **logo mark だけは lucide ではない**（独自の square-cap 幾何形）。外部サービス公式ロゴも例外
- アイコン系統の混在は禁止 — lucide に無い形が必要になったら lucide の grid/stroke に揃えて手書きする

## Logo

- Logomark: **二人の筆跡 m** — 書き手と編集者が同じ原稿を見る二つの山。24px grid、stroke 2.4、square caps、miter joins、`currentColor` 単色

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
     stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <path d="M3 19V8l4.5-3L12 8v11"/><path d="M12 8l4.5-3L21 8v11"/>
</svg>
```

- Wordmark: `minaosi` の全7文字を mark と同じ stroke 2.4、square caps、miter joins で構築する。先頭の m は mark の二つの山を wordmark 用の比率で描き直し、全字の肩の高さとベースラインを SVG 内で揃える。正本は `apps/extension/assets/wordmark.svg`（`viewBox="0 -2 99.25 24"`）。オプション画面では SVG の高さを `--font-size-brand`（14px）とし、幅は縦横比から決める。フォントや CSS の文字ごとの transform 補正には依存しない
- 字幅: パス中心線の横幅は m=15、n=10、a=10、o=11、s=9。i は線幅 2.4 の縦線と点で構成する。m の幅を n の 1.5 倍に抑えて先頭の量感を整える。閉じた o は内側の余白を確保するために広げ、s は斜線の横への張りを抑えるために細くする
- カーニング: 隣接するパス中心線の最右端と最左端の距離を mi=6.75、in=6.75、na=6.5、ao=6、os=6、si=6.25 とする（SVG 単位。ストロークを含む見える余白とは異なる）。前半の縦線が密集して見えないよう mi/in に余白を取り、名前の終端でも i が s に寄りすぎないよう si にも余白を確保する。字幅と字間は SVG に焼き込み、CSS の一律 letter-spacing で上書きしない。変更時は高さ 14px の実使用表示と 28/96px の拡大表示を比較する
- 配置: サイドpaneの名前とアイコンはブラウザの標準ヘッダーに委ね、pane内では重複させない。開閉はブラウザの操作に委ね、paneの背景は透明にする
- Assets: 拡張アイコン（16/48/128px）はこの mark をそのままスケール。mono バリアント（`currentColor`）のみで、accent 入りのバリアントは作らない
- Clearspace: mark の高さの 1/4 を最小余白とする

## Motion

- `--ease-out` + `--dur-fast/med` で追加は fade + slide-up、対応・削除は fade-out、一覧の移動は位置補間。選択詳細は slide-up で開く
- カード操作ボタンは上端から 20px（従来より 4px 下）
- `prefers-reduced-motion` では animation と transition を無効化する

## Exports

- `docs/prd/note-inline-review/prototype/` の `notes.html` + `tokens.css` — 検証済み prototype のスナップショット。値は本ファイルから手動で写す（生成スクリプトはない）
- `.agent/prototypes/finding-display/` は同内容の作業用コピー（gitignore 内・未追跡）
- `tokens.css` の変数名は本ファイルの語彙への手動マッピング。drift は検査で拾う: `python3 .agents/skills/product-design/tools/brand-css-check.py design.md`（未定義 var・`--on-*` ペアの AA コントラスト）

## Notes

- Font: **system stack** を採用。理由: chrome は surface（執筆サイト）の書体に馴染ませたい — webfont を同梱して独自の顔を作るより、各 OS の system UI 書体に任せる方がホスト面に溶ける。候補だった Noto Sans JP / IBM Plex Sans JP / Zen Kaku Gothic New は「独自顔の主張が chrome に要らない」として棄却
- Logo: codex（gpt-6-sol）による発散から「二人の筆跡」を採用。棄却: 行+チェック（凡庸）、キャレット、ペン先、用紙+✓、nib（いずれも「ダサい」評）、brackets / 重なり枠 / 軌跡 / 欄外（m2 より固有性が弱い評）
- Wordmark: 先頭の文字版と全体版を比較し、全7文字を構築する全体版を採用。単体の logomark と名前全体の wordmark を使い分ける。wordmark の m は単体 mark より幅を抑え、残りの文字も広げた「比率」案を採用。mi/in の字間は前半の詰まりを減らすために広げる
- Icons: 手書き混在（stroke 1.1〜1.9 で散らかっていた）から Lucide へ統一
- Accent: 藍（hue 264）から緑（hue 155）へ — 「編集者の緑ペン」
