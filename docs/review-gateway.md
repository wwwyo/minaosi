# 校閲サーバーと Cloudflare AI Gateway

拡張の background → minaosi の校閲サーバー → Cloudflare AI Gateway → 選んだ AI プロバイダーの順で通信する。校閲サーバーは TanStack AI で検索・tool calling を実行し、指摘を共通形式へ検証して返す。拡張側の UI と本文への適用は従来どおり。

## ログイン不要の BYOK

利用者は自分の Anthropic / OpenAI のキーを拡張に登録する。拡張はキーをローカルに保存し、校閲ごとに `x-minaosi-api-key` ヘッダーでサーバーへ渡す。サーバーはそのリクエストの間だけキーを使い、アカウント・Cookie・Gatewayへのキー登録は要求しない。プロバイダーへの直接接続へのフォールバックはない。

Gateway の `default` 保存キーや運営者の AI 課金を利用しないよう、利用者のキーがないリクエストは必ず拒否する。Gateway の認証トークンはサーバーだけに置き、拡張には含めない。Gateway のキャッシュと本文ログはリクエスト単位で無効化し、Worker の observability も無効にする。AI プロバイダー側のデータ保持は各社の契約・設定に従う。

この方式はGatewayにキーを保存する方式とは異なる。複数端末への同期や、保存キーを匿名端末トークンで利用する仕組みはまだ実装しない。拡張のローカル保存は秘密専用の保管庫ではなく、端末や拡張が侵害された場合のキー流出は防げない。

## ローカル起動

```bash
mise install
mise exec -- bun install
mise exec -- bun run api:dev
# 別の Orca terminal
mise exec -- bun run dev
```

校閲サーバーは `http://127.0.0.1:8787` で起動する。開発用拡張の接続先は既定で `/review`。`GET /health` の `configured` はGateway接続設定の有無だけを返し、AIを呼び出さない。

次の環境変数を mise から注入する。秘密は secret-env skill の mise + age の手順で管理し、平文の `.env` や `.dev.vars` は作らない。

| 変数 | 用途 |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Gatewayを所有するアカウント |
| `CLOUDFLARE_AI_GATEWAY_ID` | 使用するGateway |
| `CF_AIG_TOKEN` | AI Gateway Run権限の接続用トークン |
| `ALLOWED_ORIGINS` | 必要に応じて拡張のOriginをカンマ区切りで指定 |

拡張のOriginは `chrome-extension://<拡張ID>` など。Originを持つリクエストは明示的に許可したものだけ受け付け、通常のWebサイトからのCORSを許可しない。OriginのないリクエストもBYOKキーが必要になる。ローカルサーバーはループバックにだけbindする。

開発時の実AI呼び出しはプロジェクト規約に従いOpenCodeを使う。現時点のこの校閲経路にはOpenCode Go用のcustom provider / 外部検索ツールをまだ追加していないため、開発の検証は模擬応答で行う。Anthropic / OpenAIの実キーを開発QAに使わない。

## Worker の公開設定

Cloudflare のリソース操作は `cf cli search` でコマンドを確認してから `cf` CLI を使う。検索文にアカウント名・ID・秘密情報を含めない。このプロジェクトは Wrangler 設定なので、ビルド・デプロイは Wrangler を使う。

```bash
mise exec -- bun run api:build
mise exec -- bun run api:deploy
mise exec -- bun run api:configure
```

`api:configure` はmiseの環境変数を `cf workers secrets bulk` にstdinで渡し、Workerへ設定する。接続用の `CF_AIG_TOKEN` と、デプロイ・設定更新用の `CLOUDFLARE_API_TOKEN` は用途を分ける。設定情報がない場合、校閲APIは503を返して外部送信しない。

公開したサーバーの `https://…/review` を `WXT_REVIEW_API_URL` に設定して拡張をビルドする。これは公開URLだけで、トークンやキーを含めない。拡張のhost permissionはこのURLのOriginだけに限定する。設定がない本番ビルドでは外部接続を許可せず、校閲実行時に未設定と表示する。

```bash
mise exec -- bun run build
mise exec -- bun run check
mise exec -- bun test
```

Workerは1IPあたり60秒に10回の呼び出し制限、原稿の文字数・リクエストサイズ制限を持つ。制限は匿名サービスの負荷抑制であり、アカウント別の請求・利用上限管理ではない。

参照: [TanStack Cloudflare adapter](https://tanstack.com/ai/latest/docs/adapters/cloudflare)、[Cloudflare BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/)。
