# インライン校閲 v1 を merge。Store submit は依然未着手

- Status: Accepted
- Date: 2026-10-01

インライン校閲 v1（[minaosi#7](https://github.com/wwwyo/minaosi/pull/7)：note 上のインライン校閲・独立 pane・BYOK）を main に採用した。校閲の自動起動は実装と切り分けて PRD として先に起票し merge（[#8](https://github.com/wwwyo/minaosi/pull/8)・[#9](https://github.com/wwwyo/minaosi/pull/9)）。標準モードは「利用者のログイン・APIキー不要」の方向に対し運営者キーと Gateway 接続設定が前提になっていたため、Workers AI binding 経路への移行（[#10](https://github.com/wwwyo/minaosi/pull/10)、open・agent 作業中）でプロバイダー契約・キー管理・Gateway 必須化を標準経路から外す方針を起動した。完了条件の Store submit は3日目も未着手
