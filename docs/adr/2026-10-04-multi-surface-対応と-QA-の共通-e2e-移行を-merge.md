# multi-surface 対応と QA の共通 e2e 移行を merge。Store submit は未着手のまま週またぎ

- Status: Accepted
- Date: 2026-10-04

書き手が既存の公開面で校閲できるよう、許可サイト横断の汎用編集欄検知 `generic.ts` を採用した（[#28](https://github.com/wwwyo/minaosi/pull/28) — 最長 editable を機械的に選ぶとコメント欄など無関係な入力を取り違えるため、確定できない場合は無効のままにする保守的な検知）。校閲の前に利用者が細かいルールや例外を用意する負担をなくす方針で、文体規範のユーザー調整機能を削除し文体判定を内部基準へ寄せた（[#29](https://github.com/wwwyo/minaosi/pull/29) — あわせて専用 qa-minaosi skill を共通 e2e skill へ置換）。[#30](https://github.com/wwwyo/minaosi/pull/30) で review-gateway の stale 修正と Turnstile・edge 防御の実測知見を還元。残る出口は Chrome Store submit のみ
