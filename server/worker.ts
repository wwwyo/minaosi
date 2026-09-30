import { reviewThroughGateway, type GatewayEnv } from './review';
import { reviewWithOpenCode } from './opencode';
import { INVALID_TOOL_INPUT } from './anthropic';
import { isReviewProvider, type ProviderReviewInput } from '../entrypoints/minaosi/review/providers';

export interface Env extends GatewayEnv {
  ALLOWED_ORIGINS?: string;
  LOCAL_OPENCODE_BYOK?: boolean;
  DEFAULT_REVIEW_PROVIDER?: string;
  DEFAULT_REVIEW_MODEL?: string;
  DEFAULT_REVIEW_API_KEY?: string;
  REVIEW_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

type ReviewInput = (ProviderReviewInput & { mode?: 'byok' }) | { mode: 'default'; blocks: ProviderReviewInput['blocks'] };
type Reviewer = typeof reviewThroughGateway;
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

/** 標準・BYOKの校閲を受け付け、原稿・キーを永続化しない。 */
export async function handleRequest(request: Request, env: Env, reviewer: Reviewer = reviewThroughGateway, opencodeReviewer = reviewWithOpenCode): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (origin && !allowed.includes(origin)) return json({ error: '許可されていない接続元です' }, 403);
  if (origin) headers.set('access-control-allow-origin', origin);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, configured: !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_GATEWAY_ID && env.CF_AIG_TOKEN) });
  }
  if (url.pathname !== '/review') return json({ error: '接続先が見つかりません' }, 404);
  if (request.method === 'OPTIONS') {
    headers.set('access-control-allow-methods', 'POST');
    headers.set('access-control-allow-headers', 'content-type,x-minaosi-api-key');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'POST') return json({ error: 'POST を使ってください' }, 405);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 形式で送信してください' }, 415);
  if (env.REVIEW_RATE_LIMIT && !(await env.REVIEW_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })).success) {
    return json({ error: '校閲の実行間隔を空けてください' }, 429);
  }
  let input: unknown;
  try { input = await readBody(request); }
  catch (error) { return json({ error: error instanceof RangeError ? '原稿が大きすぎます' : 'JSON 形式が不正です' }, error instanceof RangeError ? 413 : 400); }
  if (!validInput(input)) return json({ error: '校閲リクエストの形式が不正です' }, 400);
  let selected: ProviderReviewInput;
  let apiKey: string;
  if (input.mode === 'default') {
    if (!isReviewProvider(env.DEFAULT_REVIEW_PROVIDER) || !validModel(env.DEFAULT_REVIEW_MODEL) || !env.DEFAULT_REVIEW_API_KEY?.trim()) {
      return json({ error: 'minaosiの標準サービスはまだ準備中です' }, 503);
    }
    selected = { provider: env.DEFAULT_REVIEW_PROVIDER, model: env.DEFAULT_REVIEW_MODEL, blocks: input.blocks };
    apiKey = env.DEFAULT_REVIEW_API_KEY.trim();
  } else {
    apiKey = request.headers.get('x-minaosi-api-key')?.trim() ?? '';
    // BYOKでキーを忘れても、運営者の課金へ切り替えない。
    if (!apiKey || apiKey.length > 4096) return json({ error: 'あなたの API key が必要です' }, 401);
    selected = { provider: input.provider, model: input.model, blocks: input.blocks };
  }

  const localOpenCode = selected.provider === 'opencode-go' && env.LOCAL_OPENCODE_BYOK && input.mode !== 'default';
  if (selected.provider === 'opencode-go' && !localOpenCode) {
    return json({ error: 'OpenCode Goの試用経路はローカルBYOKで利用できます' }, 503);
  }
  if (!localOpenCode && (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_GATEWAY_ID || !env.CF_AIG_TOKEN)) {
    return json({ error: 'Cloudflare AI Gateway の接続設定がまだ完了していません' }, 503);
  }
  try {
    const findings = localOpenCode ? await opencodeReviewer(selected, apiKey) : await reviewer(selected, apiKey, env);
    return json({ findings });
  } catch (error) {
    // upstream のエラー本文に原稿や認証情報が含まれる可能性があるため返送・記録しない。
    return json({ error: error instanceof Error && error.message === INVALID_TOOL_INPUT ? INVALID_TOOL_INPUT : '校閲に失敗しました。API key・モデル・Gateway の接続設定を確認してください' }, 502);
  }
}

export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
