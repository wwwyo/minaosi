import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { INVALID_TOOL_INPUT } from '../review/errors';
import { ModelSchema, ReviewInputSchema } from '../review/input';
import type { AiBinding, ProviderReviewInput, ReviewBlock, ReviewedFinding } from '../review/schema';
import { readBoundedBody } from './body';

export interface ConcurrencyService {
  acquire(): Promise<string | null>;
  release(id: string): Promise<void>;
}
interface ReviewBindings {
  AI?: AiBinding;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_REVIEW_MODEL?: string;
  REVIEW_GATEWAY_ID?: string;
  LOCAL_OPENCODE_BYOK?: string;
  REVIEW_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  REVIEW_CONCURRENCY?: { getByName(name: string): ConcurrencyService };
}
interface RpcEnv {
  Bindings: {
    bindings: ReviewBindings;
    reviewer: (input: ProviderReviewInput, key: string, env: ReviewBindings) => Promise<ReviewedFinding[]>;
    opencodeReviewer: (input: ProviderReviewInput, key: string) => Promise<ReviewedFinding[]>;
    standardReviewer: (input: { model: string; blocks: ReviewBlock[] }, env: ReviewBindings) => Promise<ReviewedFinding[]>;
  };
}

const reviewBoundary = createMiddleware<RpcEnv>(async (c, next) => {
  const request = c.req.raw;
  const env = c.env.bindings;
  if (!request.headers.get('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON 形式で送信してください' }, 415);
  if (env.REVIEW_RATE_LIMIT && !(await env.REVIEW_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })).success) {
    return c.json({ error: '校閲の実行間隔を空けてください' }, 429);
  }
  try {
    const body = await readBoundedBody(request);
    // サイズ確認で元の本文を消費するため、validatorへ同じ本文を再供給する。
    c.req.raw = new Request(request, { body });
  } catch (error) {
    if (error instanceof RangeError) return c.json({ error: '原稿が大きすぎます' }, 413);
    return c.json({ error: 'JSON 形式が不正です' }, 400);
  }
  await next();
});

const reviewInput = zValidator('json', ReviewInputSchema, (result, c) => {
  // Zodの詳細には入力値が含まれ得るため、公開する診断は固定する。
  if (!result.success) return c.json({ error: '校閲リクエストの形式が不正です' }, 400);
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
    return c.json({ ok: true, configured: !!env.AI, byokConfigured: !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY_ID && env.CF_AIG_TOKEN) }, 200);
  })
  .options('/review', c => {
    c.header('access-control-allow-methods', 'POST');
    c.header('access-control-allow-headers', 'content-type,x-minaosi-api-key');
    return c.body(null, 204);
  })
  .post('/review', reviewBoundary, reviewInput, async c => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const { bindings: env, reviewer, opencodeReviewer, standardReviewer } = c.env;
    const input = c.req.valid('json');
    let standard: { model: string; blocks: ReviewBlock[] } | undefined;
    let selected: ProviderReviewInput | undefined;
    let apiKey = '';
    if (input.mode === 'default') {
      const model = ModelSchema.safeParse(env.DEFAULT_REVIEW_MODEL);
      if (!model.success) return c.json({ error: 'minaosiの標準サービスはまだ準備中です' }, 503);
      if (!env.AI) return c.json({ error: '標準校閲のAI接続がまだ準備できていません' }, 503);
      standard = { model: model.data, blocks: input.blocks };
    } else {
      apiKey = request.headers.get('x-minaosi-api-key')?.trim() ?? '';
      // BYOKでキーを忘れても、運営者の課金へ切り替えない。
      if (!apiKey || apiKey.length > 4096) return c.json({ error: 'あなたの API key が必要です' }, 401);
      selected = { provider: input.provider, model: input.model, blocks: input.blocks };
    }

    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const localOpenCode = selected?.provider === 'opencode-go' && loopback && env.LOCAL_OPENCODE_BYOK === 'true';
    if (selected?.provider === 'opencode-go' && !localOpenCode) {
      return c.json({ error: 'OpenCode Goの試用経路はローカルBYOKで利用できます' }, 503);
    }
    if (selected && !localOpenCode && (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_GATEWAY_ID || !env.CF_AIG_TOKEN)) {
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
      const findings = standard
        ? await standardReviewer(standard, env)
        : localOpenCode ? await opencodeReviewer(selected!, apiKey) : await reviewer(selected!, apiKey, env);
      return c.json({ findings }, 200);
    } catch (error) {
      // upstream のエラー本文に原稿や認証情報が含まれる可能性があるため返送・記録しない。
      const failure = input.mode === 'default'
        ? '標準校閲に失敗しました。時間を置いて再試行し、続く場合は運営者へ連絡してください'
        : '校閲に失敗しました。API key・モデル・Gateway の接続設定を確認してください';
      return c.json({ error: error instanceof Error && error.message === INVALID_TOOL_INPUT ? INVALID_TOOL_INPUT : failure }, 502);
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
app.onError((error, c) => {
  if (error instanceof HTTPException && error.status === 400) return c.json({ error: 'JSON 形式が不正です' }, 400);
  return c.json({ error: '校閲サーバーで処理に失敗しました' }, 500);
});
app.notFound(c => c.json({ error: '接続先が見つかりません' }, 404));

export type AppType = typeof app;
