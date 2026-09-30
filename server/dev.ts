import { handleRequest, type Env } from './worker';

const env: Env = {
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  CLOUDFLARE_AI_GATEWAY_ID: process.env.CLOUDFLARE_AI_GATEWAY_ID ?? '',
  CF_AIG_TOKEN: process.env.CF_AIG_TOKEN ?? '',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  LOCAL_OPENCODE_BYOK: true,
  DEFAULT_REVIEW_PROVIDER: process.env.DEFAULT_REVIEW_PROVIDER,
  DEFAULT_REVIEW_MODEL: process.env.DEFAULT_REVIEW_MODEL,
  DEFAULT_REVIEW_API_KEY: process.env.DEFAULT_REVIEW_API_KEY,
};
const server = Bun.serve({
  hostname: '127.0.0.1', port: 8787, idleTimeout: 255,
  fetch: (request) => handleRequest(request, env),
});
console.log(`minaosi review server: ${server.url}`);
