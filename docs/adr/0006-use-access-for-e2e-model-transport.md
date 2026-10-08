---
status: accepted
---

# E2E 操作用モデルを Access session で呼ぶ

操作用モデルには個人の Cloudflare Access session を使い、既存の AI SDK に認証を閉じ込めた transport を接続する。長期 key の暗黙 fallback とテスト内の対話ログインを廃し、期限切れは明示的に失敗させる。無人 CI に個人 session や共有 service token を配布する代わりに、CI は秘密不要の実拡張テストを担当し、実モデル操作はログイン済みのローカル実行で別に検証する。校閲 API の BYOK credential とこの認証境界は共有しない。
