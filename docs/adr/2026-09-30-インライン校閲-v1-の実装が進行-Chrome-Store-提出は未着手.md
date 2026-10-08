# インライン校閲 v1 の実装が進行、Chrome Store 提出は未着手

- Status: Accepted
- Date: 2026-09-30

v1 の構成として、note エディタ上のインライン校閲（指摘は本文上で確認、適用は書き手が操作）＋ブラウザ標準の独立サイド pane、AI 連携は background → Hono Worker → TanStack AI → Cloudflare AI Gateway → provider の経路を採用して [minaosi#7](https://github.com/wwwyo/minaosi/pull/7)（open）で実装を進めた。標準（運営者キーの DeepSeek）と BYOK（利用者キー）を同一経路に載せ、TanStack AI の adapter で provider 差分を吸収する判断。日本語ルールは常時適用とし、ルールのトグル・一覧・送信同意画面・ログインは設けない範囲切りも同日確定。宣言上の完了条件（Store submit）には未到達で、翌日へ持ち越し
