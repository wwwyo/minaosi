---
status: accepted
---

# 実モデル E2E はローカル実行に限り、操作モデルは校閲モデルと分ける

E2E が UI 操作に使うモデルは、本番の校閲モデル（`DEFAULT_REVIEW_MODEL`）とは別の役割として `E2E_MODEL` で供給し、校閲モデルへの fallback は持たない。UI 操作には画像認識・structured output・tool calling の実機能力が要り、校閲品質とは別の基準で選ぶ。接続先が Cloudflare Access の対話ログインを前提とするため実モデル E2E は CI に載せずローカル実行に限り、モデル不要の部分は offline 実行で確認する。CI での実 UI 回帰検知を失う代わりに、秘密と対話的な認証を CI に置かない選択である。
