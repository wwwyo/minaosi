# minaosi

## Story

自分で文章を書く人が、公開される見え方のままの画面の上で、もう一人の編集者の指摘を受け取れる。

Core actions:
- 書いている原稿にレビューをかけて指摘を見る — 記事を書くたび
- 指摘を採用するか自分で判断して直す — 記事を書くたび

## Glossary

- **原稿（draft）**: 書き手が surface のエディタで書いている、公開前の記事本文
- **指摘（finding）**: 原稿の特定箇所に対する校閲の結果。種類（誤字・事実・日本語ルール・文体）、対象箇所のアンカー、理由を持ち、事実の指摘は出典を持つ。原稿を書き換える操作は含まない（適用は書き手が行う）
- **アンカー（anchor）**: 指摘が原稿のどの要素（段落・画像・改行など）を指すかの参照
- **出典（source）**: 事実の指摘の根拠となる一次情報の参照（URL と該当箇所）
- **surface（surface）**: 原稿を書き、公開面と同じ見え方で表示する執筆画面（note のエディタなど）。surface ごとの差分は adapter に隔離する
- **rubric（rubric）**: 何を指摘し何を指摘しないかの判定基準。日本語ルールと文体・読みやすさを扱い、原稿の文脈を考慮する
- **日本語ルール（language rule）**: rubric のうち、誰が書いても同じ基準で判定する層（語尾の連続・文体の混在・テニオハなど）。共通の規則を全利用者に適用する
- **文体（style）**: 原稿の語尾・語彙・段落構成・リズムなどの表現上の特徴。校閲では原稿の文脈に照らして一貫性と読みやすさを確認し、書き手の声を尊重する

## ディレクトリ構造

```
minaosi/
├── apps/
│   ├── extension/ # WXT拡張。entrypoints/ がブラウザの入口
│   └── api/       # Hono / Cloudflare Worker。src/ がBE実装
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
bun run build  # 拡張を apps/extension/.output/ へ build
bun run zip    # 配布用 zip を apps/extension/.output/ へ生成
```

## 技術スタック

- TypeScript / Bun / WXT（Manifest V3、multi-browser 対応の拡張 FW）
- HTTP／HTTPSページの執筆画面をヒューリスティックで検知する。初版は通常のcontenteditableのみ。本文を確定できない場合は無効とし、入力方式ごとの差分はadapterへ隔離する（範囲と検証は `docs/prd/multi-surface/research.md`）

## 設計の軸

- **AI は生成側ではなく校閲側**。提案の適用は必ず人間が行う（文章の主導権を人間に残す設計上の歯止め）
- **指摘は「見ている面」に重ねる**。text レポートではなく、公開面の段落・画像・改行にアンカーした UI 表示が価値の本体
- 校閲の判定基準はプロダクト内部で管理する。利用者に規範ファイルや細かなルールの設定を求めず、日本語ルール・文体・読みやすさを原稿の文脈に照らして確認する。差別化軸は出典付きの事実の指摘・multi-surface・OSSである

## Skills

- 学び・ハマりどころ・過去の失敗は `.agents/skills/<topic>/` を参照

### E2E

- E2E の導入・実装・実行・失敗調査は共通の `e2e` skill を使う。repo の設定は `e2e.config.ts`、実行は `mise exec -- bun run test:e2e`。repo 内に共通 skill を複製しない。
- PRD の criterion と実行証跡を対応させ、`agent.act()` の後に実際の値・永続化・副作用を検証する。実 UI・実 AI・外部サービスの未確認項目は、ローカルテストの成功と分けて報告する。
- 操作用 LLM は `CF_AI_ACCESS_URL` と既存の Access session を使う。旧 key への fallback やテスト内の対話ログインはしない。`check:e2e:model` で vision/schema/tool call を確認する。CI は `test:e2e:offline` のモデル不要部分のみ。責務と上限は `docs/e2e-execution.md`、復旧と要件対応は `tests/README.md` を参照する。

### Hono

- Honoのルーティング・middleware・validation・RPC・テストでは、公式の `.agents/skills/hono/SKILL.md` を参照する。
- skillのWrangler向け手順より、このrepoの `cf`＋Cloudflare Vite plugin構成を優先する。bindingsの型生成は `bun run --cwd apps/api check` 内の `cf workers types` を使い、bindings付きの実通信検証は `bun run api:dev` のworkerdで行う。
- skill内の `@hono/cli@next` は自動追加しない。CLIを追加するときもrepoのexact指定・cooldown 7日のルールに従う。

### Cloudflare

- CloudflareのCLI操作は `.agents/skills/cloudflare-cf/SKILL.md` を使う。`cf` を優先し、コマンドは匿名の操作説明で `cf cli search` から探す。
- プロダクト選定・AI Gatewayの参照資料は `.agents/skills/cloudflare/SKILL.md`、Worker実装は `.agents/skills/workers-best-practices/SKILL.md` を参照する。
- 校閲APIのローカル開発は `bun run api:dev` からWorkersシミュレーター（workerd）で行う。OpenCode Goの試用も同じ実行環境を使い、Bunの別サーバーで代替しない。
