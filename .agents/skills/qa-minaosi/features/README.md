# minaosi feature map

共通の起動・URL・隔離・終了は[Launch](../SKILL.md#launch)、[Doctor](../SKILL.md#doctor)、[Drive](../SKILL.md#drive)、[Cleanup](../SKILL.md#cleanup)に従う。証拠は[Evidence](../SKILL.md#evidence)へ保存する。すべてのrecipeは自分で起動したinstanceだけを使う。noteはテストアカウントの合成下書き、browserは当runの専用profileを使う。

| Feature ID | File | User-visible behavior |
| --- | --- | --- |
| panel | [panel.md](panel.md) | 独立paneの開閉とタブへの再接続 |
| settings | [settings.md](settings.md) | 標準/BYOK、モデルとキーの保存 |
| review | [review.md](review.md) | 校閲実行、進行表示と失敗時の状態 |
| finding-actions | [finding-actions.md](finding-actions.md) | 選択・適用・取り消し・削除・復元・編集後の保護 |
| service | [service.md](service.md) | HTTPのhealthと不正な接続・要求の拒否 |

UIのindexは毎回最新AXから取得する。label/roleとURLを優先し、固定座標・固定AX番号は使わない。本文に入力した内容は、操作後の本文を読んで確かめる。各sub-featureを少なくとも1つのentrypointで検証し、使わなかったentrypointもfeatureごとに列挙する。

2026-10-01 initで実操作したのは`service.1`〜`service.4`のみ。ほかはsource-derivedであり、以前の個人Chromeや固定応答の結果を今回のcoverageへ繰り越さない。
