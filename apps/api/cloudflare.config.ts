import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig(({ mode }) => ({
  worker: {
    name: 'minaosi-review',
    entrypoint: 'src/index.ts',
    compatibilityDate: '2026-09-22',
    compatibilityFlags: ['nodejs_compat'],
    // 本番の workers.dev は閉じる。プレビューは Worker の previews 専用 Access policy で保護し、
    // 本番デプロイでプレビューURLを再び無効化しないよう、ここでも有効にする。
    workersDev: false,
    previewUrls: true,
    exports: { ReviewConcurrency: exports.durableObject({ storage: 'sqlite' }) },
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 1 },
      traces: { enabled: true, headSamplingRate: 1 },
    },
    env: {
      CLOUDFLARE_ACCOUNT_ID: bindings.secret(),
      CLOUDFLARE_AI_GATEWAY_ID: bindings.secret(),
      CF_AIG_TOKEN: bindings.secret(),
      DEFAULT_REVIEW_MODEL: bindings.text<string>('@cf/deepseek-ai/deepseek-v4-flash-0731'),
      // 標準経路をGatewayログへ流す場合だけ設定する。binding経路はpayload抑制ヘッダーを送れないため、本文非保存はGateway側の設定に依存する。
      REVIEW_GATEWAY_ID: bindings.text<string>(''),
      ALLOWED_ORIGINS: bindings.secret(),
      // Turnstile widget の sitekey。秘密ではなくクライアントへ配る値。開発時は always-pass のテストキー（invisible）。
      // 本番値は `minaosi.syokan.dev` に紐付く widget のもの。別ホストへ deploy する場合は
      // その hostname で widget を作り直し、ここの値を差し替える（siteverify の hostname 照合で弾かれるため）。
      TURNSTILE_SITE_KEY: bindings.text<string>(mode === 'development' ? '1x00000000000000000000BB' : '0x4AAAAAAFLTQAfNx0YoHv9S'),
      TURNSTILE_SECRET_KEY: bindings.secret(),
      REVIEW_POLICY: bindings.json<{ concurrencyLimit: number; leaseTtlMs: number }>({
        concurrencyLimit: 10,
        leaseTtlMs: 240_000,
      }),
      REVIEW_CONCURRENCY: bindings.durableObject({ worker: 'minaosi-review', exportName: 'ReviewConcurrency' }),
      AI: bindings.ai({ dev: { remote: true } }),
      REVIEW_RATE_LIMIT: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 10, period: 60 },
      }),
    },
  },
}));
