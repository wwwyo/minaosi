# 校閲 API を本番化し、ブランドとパネル UI を仕上げた。Store submit は4日目も未着手

- Status: Accepted
- Date: 2026-10-02

[minaosi#10](https://github.com/wwwyo/minaosi/pull/10)（標準校閲を Workers AI binding 経路へ）・[#11](https://github.com/wwwyo/minaosi/pull/11)/[#12](https://github.com/wwwyo/minaosi/pull/12)（Turnstile 人間性確認と本番 sitekey）・[#15](https://github.com/wwwyo/minaosi/pull/15)-[#18](https://github.com/wwwyo/minaosi/pull/18)（Workers Traces・invocation logs・workers.dev 公開入口の無効化・custom domain `minaosi.syokan.dev`）を merge し本番運用面を揃えた。[#13](https://github.com/wwwyo/minaosi/pull/13) で DuckDuckGo 検索による事実確認を標準校閲へ追加（[#24](https://github.com/wwwyo/minaosi/pull/24) の Tavily 経路は別案として open のまま）。[#19](https://github.com/wwwyo/minaosi/pull/19) で文体規範ファイル読み込み、[#20](https://github.com/wwwyo/minaosi/pull/20)/[#21](https://github.com/wwwyo/minaosi/pull/21)/[#23](https://github.com/wwwyo/minaosi/pull/23) で wordmark を全字構築→光学補正→字間調整と3段で改善、[#22](https://github.com/wwwyo/minaosi/pull/22) でパネル UI を未対応常時表示＋対応済み折りたたみへ改修
