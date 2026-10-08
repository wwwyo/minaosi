# release 手順は確定。Store submit 未着手6日目、残るは掲載素材とプライバシー申告

- Status: Accepted
- Date: 2026-10-04

preview 公開は Access（Previews only）＋ workersDev 無効化で抑え、Workers Builds の結果は `cf builds list --external-script-id <tag>`（tag は Worker 名でなくシステム生成の ID）で確認する運用に確定。product 方針として「ユーザー調整項目を UI に露出しない」ことを決め、BYOK の API key は `browser.storage.local`（拡張 ID スコープ）に保存する方式に固定。ただし storage.local は既定で content script からも到達可能なので、`browser.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` で trusted context 限定にするのを保存先決定の条件とする。なお worktree から外部 API の実検証をするには Gateway 接続設定が要り、未設定のままでは E2E 未検証と明記して PR を出す
