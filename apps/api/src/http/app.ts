import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { INVALID_TOOL_INPUT } from '../review/errors';
import { ModelSchema, ReviewInputSchema } from '../review/input';
import type { WorkersAiReviewInput } from '../review/providers/workers-ai';
import type { AiBinding, ProviderReviewInput, ReviewedFinding, ReviewResult } from '../review/schema';
import { readBoundedBody } from './body';
import { readTurnstileToken, turnstilePage, TURNSTILE_REJECT_MESSAGE, type TurnstileVerifier } from './turnstile';

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
  REVIEW_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  REVIEW_CONCURRENCY?: { getByName(name: string): ConcurrencyService };
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
interface RpcEnv {
  Bindings: {
    bindings: ReviewBindings;
    reviewer: (input: ProviderReviewInput, key: string, env: ReviewBindings) => Promise<ReviewedFinding[]>;
    standardReviewer: (input: WorkersAiReviewInput, env: ReviewBindings) => Promise<ReviewResult>;
    turnstileVerifier: TurnstileVerifier;
  };
}

const reviewBoundary = createMiddleware<RpcEnv>(async (c, next) => {
  const request = c.req.raw;
  const env = c.env.bindings;
  // siteverify 呼出しは rate limit より後に置く。先に呼ぶと、偽トークンの連打が
  // 外部への subrequest 増幅になる。有無と形式の確認だけでは送信しない。
  const turnstileToken = readTurnstileToken(request);
  if (!turnstileToken) return c.json({ error: TURNSTILE_REJECT_MESSAGE }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON 形式で送信してください' }, 415);
  if (env.REVIEW_RATE_LIMIT && !(await env.REVIEW_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })).success) {
    return c.json({ error: '校閲の実行間隔を空けてください' }, 429);
  }
  const turnstile = await c.env.turnstileVerifier(
    { token: turnstileToken, remoteip: request.headers.get('cf-connecting-ip'), hostname: new URL(request.url).hostname },
    env,
  );
  if (!turnstile.ok) return c.json({ error: turnstile.error }, turnstile.status);
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
  .get('/turnstile', c => {
    const sitekey = c.env.bindings.TURNSTILE_SITE_KEY;
    if (!sitekey) return c.json({ error: '人間性の確認の設定がまだ完了していません' }, 503);
    const nonce = crypto.randomUUID();
    c.header(
      'content-security-policy',
      // frame-ancestors で拡張以外の埋め込みを禁じる。任意サイトへ埋められると
      // widget の hostname がこのオリジンになる正当トークンを量産できるため。
      `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; img-src https://challenges.cloudflare.com data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors chrome-extension: moz-extension: safari-web-extension:`,
    );
    return c.html(turnstilePage(sitekey, nonce));
  })
  .options('/review', c => {
    c.header('access-control-allow-methods', 'POST');
    c.header('access-control-allow-headers', 'content-type,x-minaosi-api-key,cf-turnstile-response');
    return c.body(null, 204);
  })
  .post('/review', reviewBoundary, reviewInput, async c => {
    const request = c.req.raw;
    const { bindings: env, reviewer, standardReviewer } = c.env;
    const input = c.req.valid('json');
    let standard: WorkersAiReviewInput | undefined;
    let selected: ProviderReviewInput | undefined;
    let apiKey = '';
    if (input.mode === 'default') {
      const model = ModelSchema.safeParse(env.DEFAULT_REVIEW_MODEL);
      if (!model.success) return c.json({ error: 'minaosiの標準サービスはまだ準備中です' }, 503);
      if (!env.AI) return c.json({ error: '標準校閲のAI接続がまだ準備できていません' }, 503);
      standard = { model: model.data, blocks: input.blocks, ...(input.styleGuide !== undefined ? { styleGuide: input.styleGuide } : {}) };
    } else {
      apiKey = request.headers.get('x-minaosi-api-key')?.trim() ?? '';
      // BYOKでキーを忘れても、運営者の課金へ切り替えない。
      if (!apiKey || apiKey.length > 4096) return c.json({ error: 'あなたの API key が必要です' }, 401);
      selected = { provider: input.provider, model: input.model, blocks: input.blocks, ...(input.styleGuide !== undefined ? { styleGuide: input.styleGuide } : {}) };
    }

    if (selected && (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_GATEWAY_ID || !env.CF_AIG_TOKEN)) {
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
      const result = standard ? await standardReviewer(standard, env) : { findings: await reviewer(selected!, apiKey, env) };
      return c.json(result, 200);
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
