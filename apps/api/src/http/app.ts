import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { INVALID_TOOL_INPUT } from '../review/errors';
import { isReviewProvider, type ProviderReviewInput, type ReviewInput, type ReviewedFinding } from '../review/schema';

export interface ConcurrencyService {
  acquire(): Promise<string | null>;
  release(id: string): Promise<void>;
}
interface ReviewBindings {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_AI_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_REVIEW_PROVIDER?: string;
  DEFAULT_REVIEW_MODEL?: string;
  DEFAULT_REVIEW_API_KEY?: string;
  LOCAL_OPENCODE_BYOK?: string;
  REVIEW_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  REVIEW_CONCURRENCY?: { getByName(name: string): ConcurrencyService };
}
interface RpcEnv {
  Bindings: {
    bindings: ReviewBindings;
    reviewer: (input: ProviderReviewInput, key: string, env: ReviewBindings) => Promise<ReviewedFinding[]>;
    opencodeReviewer: (input: ProviderReviewInput, key: string) => Promise<ReviewedFinding[]>;
  };
}

const MAX_BODY_BYTES = 262_144;

function validInput(value: unknown): value is ReviewInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<ProviderReviewInput> & { mode?: unknown };
  if (input.mode !== undefined && input.mode !== 'byok' && input.mode !== 'default') return false;
  if (input.mode !== 'default' && (!isReviewProvider(input.provider) || !validModel(input.model))) return false;
  if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 2000) return false;
  const indices = new Set<number>();
  let characters = 0;
  for (const block of input.blocks) {
    if (!block || !Number.isSafeInteger(block.index) || block.index < 0 || indices.has(block.index) || typeof block.text !== 'string') return false;
    indices.add(block.index);
    characters += block.text.length;
  }
  return characters <= 80_000;
}

function validModel(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(value);
}

async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new RangeError();
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

const reviewInput = createMiddleware<RpcEnv, '/review', { in: { json: ReviewInput }; out: { json: ReviewInput } }>(async (c, next) => {
  const request = c.req.raw;
  const env = c.env.bindings;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON 形式で送信してください' }, 415);
  if (env.REVIEW_RATE_LIMIT && !(await env.REVIEW_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })).success) {
    return c.json({ error: '校閲の実行間隔を空けてください' }, 429);
  }
  let input: unknown;
  try { input = await readBody(request); }
  catch (error) {
    if (error instanceof RangeError) return c.json({ error: '原稿が大きすぎます' }, 413);
    return c.json({ error: 'JSON 形式が不正です' }, 400);
  }
  if (!validInput(input)) return c.json({ error: '校閲リクエストの形式が不正です' }, 400);
  c.req.addValidatedData('json', input);
  await next();
});

export const app = new Hono<RpcEnv>()
  .use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    c.header('x-content-type-options', 'nosniff');
    c.header('vary', 'Origin');
    const origin = c.req.header('origin');
    if (origin) {
      const allowed = (c.env.bindings.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim());
      if (!allowed.includes(origin)) return c.json({ error: '許可されていない接続元です' }, 403);
      c.header('access-control-allow-origin', origin);
    }
    await next();
  })
  .get('/health', c => {
    const env = c.env.bindings;
    return c.json({ ok: true, configured: !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY_ID && env.CF_AIG_TOKEN) }, 200);
  })
  .options('/review', c => {
    c.header('access-control-allow-methods', 'POST');
    c.header('access-control-allow-headers', 'content-type,x-minaosi-api-key');
    return c.body(null, 204);
  })
  .post('/review', reviewInput, async c => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const { bindings: env, reviewer, opencodeReviewer } = c.env;
    const input = c.req.valid('json');
    let selected: ProviderReviewInput;
    let apiKey: string;
    if (input.mode === 'default') {
      if (!isReviewProvider(env.DEFAULT_REVIEW_PROVIDER) || !validModel(env.DEFAULT_REVIEW_MODEL) || !env.DEFAULT_REVIEW_API_KEY?.trim()) {
        return c.json({ error: 'minaosiの標準サービスはまだ準備中です' }, 503);
      }
      selected = { provider: env.DEFAULT_REVIEW_PROVIDER, model: env.DEFAULT_REVIEW_MODEL, blocks: input.blocks };
      apiKey = env.DEFAULT_REVIEW_API_KEY.trim();
    } else {
      apiKey = request.headers.get('x-minaosi-api-key')?.trim() ?? '';
      // BYOKでキーを忘れても、運営者の課金へ切り替えない。
      if (!apiKey || apiKey.length > 4096) return c.json({ error: 'あなたの API key が必要です' }, 401);
      selected = { provider: input.provider, model: input.model, blocks: input.blocks };
    }

    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const localOpenCode = selected.provider === 'opencode-go' && loopback && env.LOCAL_OPENCODE_BYOK === 'true' && input.mode !== 'default';
    if (selected.provider === 'opencode-go' && !localOpenCode) {
      return c.json({ error: 'OpenCode Goの試用経路はローカルBYOKで利用できます' }, 503);
    }
    if (!localOpenCode && (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_GATEWAY_ID || !env.CF_AIG_TOKEN)) {
      return c.json({ error: 'Cloudflare AI Gateway の接続設定がまだ完了していません' }, 503);
    }
    let concurrency: ConcurrencyService | undefined;
    let lease: string | null = null;
    if (input.mode === 'default') {
      if (!env.REVIEW_CONCURRENCY) return c.json({ error: '標準サービスの実行枠がまだ準備できていません' }, 503);
      concurrency = env.REVIEW_CONCURRENCY.getByName('standard');
      lease = await concurrency.acquire();
      if (!lease) return c.json({ error: '校閲が混み合っています。少し待ってからお試しください' }, 429);
    }
    try {
      const findings = localOpenCode ? await opencodeReviewer(selected, apiKey) : await reviewer(selected, apiKey, env);
      return c.json({ findings }, 200);
    } catch (error) {
      // upstream のエラー本文に原稿や認証情報が含まれる可能性があるため返送・記録しない。
      return c.json({ error: error instanceof Error && error.message === INVALID_TOOL_INPUT ? INVALID_TOOL_INPUT : '校閲に失敗しました。API key・モデル・Gateway の接続設定を確認してください' }, 502);
    } finally {
      if (concurrency && lease) {
        try { await concurrency.release(lease); }
        catch {
          // 枠の解放に失敗しても校閲結果は失わない。枠は有効期限で回収される。
          console.error({ event: 'review_lease_release_failed' });
        }
      }
    }
  });

// Including $all in the RPC schema intersects POST's response with the 405 fallback.
app.all('/review', c => c.json({ error: 'POST を使ってください' }, 405));

// Upstream and binding exceptions can contain credentials; do not use Hono's raw-error logger.
app.onError((_error, c) => c.json({ error: '校閲サーバーで処理に失敗しました' }, 500));
app.notFound(c => c.json({ error: '接続先が見つかりません' }, 404));

export type AppType = typeof app;
