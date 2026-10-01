# minaosi

## Story

自分で文章を書く人が、公開される見え方のままの画面の上で、もう一人の編集者の指摘を受け取れる。

Core actions:
- 書いている原稿にレビューをかけて指摘を見る — 記事を書くたび
- 指摘を採用するか自分で判断して直す — 記事を書くたび

## Glossary

- **原稿（draft）**: 書き手が surface のエディタで書いている、公開前の記事本文
- **指摘（finding）**: 原稿の特定箇所に対する校閲の結果。種類（誤字・事実・日本語ルール・文体規範）、対象箇所のアンカー、理由を持ち、事実の指摘は出典を持つ。原稿を書き換える操作は含まない（適用は書き手が行う）
- **アンカー（anchor）**: 指摘が原稿のどの要素（段落・画像・改行など）を指すかの参照
- **出典（source）**: 事実の指摘の根拠となる一次情報の参照（URL と該当箇所）
- **surface（surface）**: 原稿を書き、公開面と同じ見え方で表示する執筆画面（note のエディタなど）。surface ごとの差分は adapter に隔離する
- **rubric（rubric）**: 何を指摘し何を指摘しないかの規範。日本語ルールと文体規範の二層からなる
- **日本語ルール（language rule）**: rubric のうち、誰が書いても同じ基準で判定する層（語尾の連続・文体の混在・テニオハなど）。既定値を全利用者に配り、書き手は個々の規則を有効・無効にできる
- **文体規範（style guide）**: rubric のうち、書き手本人が書いた文章による層（文末・語彙・段落構成・リズムなど）。書き手が用意しなければ存在しない

## ディレクトリ構造

```
minaosi/
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
- rubric は日本語ルールと文体規範の二層に分け、どちらも書き手が設定できる。規範に沿った指摘は note pro が既に提供しているため差別化軸ではない。差別化軸は出典付きの事実の指摘・multi-surface・規範ファイルの直接読み込みと OSS

## Skills

- 学び・ハマりどころ・過去の失敗は `.agents/skills/<topic>/` を参照

### Cloudflare

- CloudflareのCLI操作は `.agents/skills/cloudflare-cf/SKILL.md` を使う。`cf` を優先し、コマンドは匿名の操作説明で `cf cli search` から探す。
- プロダクト選定・AI Gatewayの参照資料は `.agents/skills/cloudflare/SKILL.md`、Worker実装は `.agents/skills/workers-best-practices/SKILL.md` を参照する。
- 校閲APIのローカル開発は `bun run api:dev` からWorkersシミュレーター（workerd）で行う。OpenCode Goの試用も同じ実行環境を使い、Bunの別サーバーで代替しない。
