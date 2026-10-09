# ADR

`docs/adr/` にはこの repo の決定だけを残す。発案・競合調査・進捗・QA 記録・短期的な変更は対象外で、経緯は `wwwyo/me` の wiki（`wiki/minaosi/`）、要件や詳細は `docs/prd/` や設計 doc に置く。

## 書き方

- ファイル名は `NNNN-english-kebab-slug.md`（連番＋英語 slug）。番号は既存の最大値+1を使う。
- frontmatter に `status` を書く（採用した決定は `accepted`）。
- タイトルと本文は日本語。タイトルは決定文（「〜する」）にし、本文は1段落にまとめて決定内容・理由・引き換えにしたものを書く。
