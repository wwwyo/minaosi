import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig(({ mode }) => ({
  worker: {
    name: 'minaosi-review',
    entrypoint: 'src/index.ts',
    compatibilityDate: '2026-09-22',
    compatibilityFlags: ['nodejs_compat'],
    exports: { ReviewConcurrency: exports.durableObject({ storage: 'sqlite' }) },
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: false, headSamplingRate: 1 },
      traces: { enabled: false },
    },
    env: {
      CLOUDFLARE_ACCOUNT_ID: bindings.secret(),
      CLOUDFLARE_AI_GATEWAY_ID: bindings.secret(),
      CF_AIG_TOKEN: bindings.secret(),
      // 標準校閲の既定モデル。tool calling対応・context 1,048,576。Workers Paid必須（無料枠では呼べない）。
      DEFAULT_REVIEW_MODEL: bindings.text<string>('@cf/deepseek-ai/deepseek-v4-flash-0731'),
      // 標準経路をGatewayログへ流す場合だけ設定する。binding経路はpayload抑制ヘッダーを送れないため、本文非保存はGateway側の設定に依存する。
      REVIEW_GATEWAY_ID: bindings.text<string>(''),
      ALLOWED_ORIGINS: bindings.secret(),
      LOCAL_OPENCODE_BYOK: bindings.text<string>(mode === 'development' ? 'true' : 'false'),
      REVIEW_POLICY: bindings.json<{ concurrencyLimit: number; leaseTtlMs: number }>({
        concurrencyLimit: 10,
        leaseTtlMs: 240_000,
      }),
      REVIEW_CONCURRENCY: bindings.durableObject({ worker: 'minaosi-review', exportName: 'ReviewConcurrency' }),
      AI: bindings.ai(),
      REVIEW_RATE_LIMIT: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 10, period: 60 },
      }),
    },
  },
}));
