import { bindings, defineConfig } from 'cf/config';

export default defineConfig(({ mode }) => ({
  worker: {
    name: 'minaosi-review',
    entrypoint: 'server/worker.ts',
    compatibilityDate: '2026-09-22',
    compatibilityFlags: ['nodejs_compat'],
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: false, headSamplingRate: 1 },
      traces: { enabled: false },
    },
    env: {
      CLOUDFLARE_ACCOUNT_ID: bindings.secret(),
      CLOUDFLARE_AI_GATEWAY_ID: bindings.secret(),
      CF_AIG_TOKEN: bindings.secret(),
      ALLOWED_ORIGINS: bindings.secret(),
      LOCAL_OPENCODE_BYOK: bindings.text<string>(mode === 'local' ? 'true' : 'false'),
      REVIEW_RATE_LIMIT: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 10, period: 60 },
      }),
    },
  },
}));
