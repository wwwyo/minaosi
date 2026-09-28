# minaosu

## Story

自分で文章を書く人が、公開される見え方のままの画面の上で、もう一人の編集者の指摘を受け取れる。

Core actions:
- 書いている原稿にレビューをかけて指摘を見る — 記事を書くたび
- 指摘を採用するか自分で判断して直す — 記事を書くたび

## ディレクトリ構造

```
minaosu/
├── entrypoints/   # WXT entrypoints（content script / background）
├── docs/          # プロジェクト固有のドキュメントを収集する dir（共有・tracked）
└── .agent/        # 同上（個人メモ。gitignore される）
```

## セットアップ

ツールは mise で管理している。

```bash
mise install   # mise.toml に従ってツールをインストール
bun install
bun run dev    # WXT dev server（拡張をロードしたブラウザが起動）
bun run check  # typecheck
bun run build  # 拡張を .output/ へ build
bun run zip    # 配布用 zip を .output/ へ生成
```

## 技術スタック

- TypeScript / Bun / WXT（Manifest V3、multi-browser 対応の拡張 FW）
- 初期ターゲット surface: note（editor.note.com の content script）。Zenn/Qiita 等への横展開を見据え、surface ごとの差分は adapter として隔離する

## 設計の軸

- **AI は生成側ではなく校閲側**。提案の適用は必ず人間が行う（文章の主導権を人間に残す設計上の歯止め）
- **指摘は「見ている面」に重ねる**。text レポートではなく、公開面の段落・画像・改行にアンカーした UI 表示が価値の本体
- rubric（何を指摘するかの規範）は設定可能にする。個人の文体規範を読ませることが差別化軸

## Skills

- 学び・ハマりどころ・過去の失敗は `.agents/skills/<topic>/` を参照
