---
status: accepted
---

# 依存更新は peer で連動する family を単位に扱い、不整合を CI で落とす

`@tanstack/ai` と `@tanstack/ai-*` の adapter は、adapter 側が本体の版を peer で要求するため、片側だけを上げると import 時に壊れる（`ai-cloudflare` 0.2.7 は `@tanstack/ai` ^0.68.0 を要求し、0.58.0 では `isFileSource` が無く落ちる）。dependabot は 1 パッケージ単位で PR を作り、cooldown は更新先の最新版で判定するため、本体だけが cooldown 中で見送られて adapter だけが上がる run が起きる。そこで dependabot の group で family を 1 つの PR にまとめ、加えて宣言済み `peerDependencies` を実際に解決される版で検証する `scripts/check-peers.ts` を `bun run check` と Workers Builds が使う `apps/api` の check に組み込む。group 化はレビュー単位を大きくし、1 つ失敗すると family 全体が止まるが、bun が peer 不整合を警告のみで通す以上、merge 前に落とす層が要る。cooldown（7 日）と exact pin は緩めない。
