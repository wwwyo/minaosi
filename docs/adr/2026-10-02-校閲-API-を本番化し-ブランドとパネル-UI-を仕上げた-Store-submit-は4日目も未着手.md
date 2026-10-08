# 校閲 API を本番化し、ブランドとパネル UI を仕上げた。Store submit は4日目も未着手

- Status: Accepted
- Date: 2026-10-02

標準校閲の Workers AI binding 経路（[minaosi#10](https://github.com/wwwyo/minaosi/pull/10)）を確定し、公開に向けた防御と公開入口の絞り込みを完了させた。無認証の公開 API をそのまま晒さないため Turnstile 人間性確認を導入し本番 sitekey を設定（[#11](https://github.com/wwwyo/minaosi/pull/11)/[#12](https://github.com/wwwyo/minaosi/pull/12)）。custom domain `minaosi.syokan.dev` を用意した上で、workers.dev 入口を残す理由がないとして workersDev と preview URL を無効化し、公開入口を custom domain に限定した（[#15](https://github.com/wwwyo/minaosi/pull/15)-[#18](https://github.com/wwwyo/minaosi/pull/18) — Workers Traces・invocation logs もここで有効化）。出典付きの事実の指摘には一次情報との照合が必要なため、DuckDuckGo 検索を標準校閲へ追加（[#13](https://github.com/wwwyo/minaosi/pull/13)。[#24](https://github.com/wwwyo/minaosi/pull/24) の Tavily 経路は別案として open のまま）。[#19](https://github.com/wwwyo/minaosi/pull/19) で文体規範ファイル読み込み、[#20](https://github.com/wwwyo/minaosi/pull/20)/[#21](https://github.com/wwwyo/minaosi/pull/21)/[#23](https://github.com/wwwyo/minaosi/pull/23) で wordmark を全字構築→光学補正→字間調整と3段で改善、[#22](https://github.com/wwwyo/minaosi/pull/22) でパネル UI を未対応常時表示＋対応済み折りたたみへ改修。Store submit は4日目も未着手
