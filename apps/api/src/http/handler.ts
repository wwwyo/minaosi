import { app, type ConcurrencyService } from './app';
export type { ConcurrencyService } from './app';
import { reviewThroughGateway, type GatewayEnv } from '../review/providers/gateway';
import { reviewWithOpenCode } from '../review/providers/opencode';
import { reviewWithWorkersAi } from '../review/providers/workers-ai';
import type { InferEnv, UnwrapConfig } from 'cf/config';
import type config from '../../cloudflare.config';

export type Env = Partial<GatewayEnv> & Partial<Omit<InferEnv<UnwrapConfig<typeof config>['worker']>, 'REVIEW_CONCURRENCY'>> & {
  REVIEW_CONCURRENCY?: { getByName(name: string): ConcurrencyService };
};

type Reviewer = typeof reviewThroughGateway;
type StandardReviewer = typeof reviewWithWorkersAi;

/** 校閲を処理し、原稿や認証情報を含まない実行結果だけを記録する。 */
export async function handleRequest(
  request: Request,
  env: Env,
  reviewer: Reviewer = reviewThroughGateway,
  opencodeReviewer = reviewWithOpenCode,
  standardReviewer: StandardReviewer = reviewWithWorkersAi,
): Promise<Response> {
  const started = performance.now();
  let response: Response;
  try {
    response = await app.fetch(request, { bindings: env, reviewer, opencodeReviewer, standardReviewer });
  } catch {
    // bindingの例外も原稿・認証情報を含む可能性があるため、生の例外を記録しない。
    const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' });
    const origin = request.headers.get('origin');
    if (origin && (env.ALLOWED_ORIGINS ?? '').split(',').some((allowed) => allowed.trim() === origin)) headers.set('access-control-allow-origin', origin);
    response = Response.json({ error: '校閲サーバーで処理に失敗しました' }, { status: 500, headers });
  }
  if (request.method === 'POST' && new URL(request.url).pathname === '/review') {
    const record = { event: 'review_request_completed', requestId: crypto.randomUUID(), status: response.status, durationMs: Math.round(performance.now() - started) };
    if (response.status >= 500) console.error(record);
    else console.log(record);
  }
  return response;
}

export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
