import { fetchWithoutRedirects } from '../review/providers/fetch';
import type { HttpFetch } from '../review/schema';

/** widget 側で埋め込む action。siteverify の応答と照合して、別用途に発行されたトークンを弾く。 */
const TURNSTILE_ACTION = 'review';
// Cloudflare がテスト用に公開している invisible の always-pass キー。実トークンを発行しないため hostname 等の照合はしない。
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000BB';
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 10_000;
const REJECTED = '人間性の確認に失敗しました。もう一度お試しください';

/** cf-turnstile-response ヘッダーの有無と形式を確認し、妥当なトークン文字列を返す。 */
export function readTurnstileToken(request: Request): string {
  const token = request.headers.get('cf-turnstile-response') ?? '';
  return token && token.length <= MAX_TOKEN_LENGTH ? token : '';
}

export interface TurnstileEnv {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface TurnstileCheck {
  token: string;
  remoteip: string | null;
  /** /turnstile の widget ページを自ホストしているため、要求ホストと一致するはず。 */
  hostname: string;
}
export type TurnstileResult = { ok: true } | { ok: false; status: 403 | 503; error: string };
export type TurnstileVerifier = (input: TurnstileCheck, env: TurnstileEnv) => Promise<TurnstileResult>;

export { REJECTED as TURNSTILE_REJECT_MESSAGE };

function resolveSecret(env: TurnstileEnv): { secret: string; testing: boolean } | null {
  const secret = env.TURNSTILE_SECRET_KEY || (env.TURNSTILE_SITE_KEY === TURNSTILE_TEST_SITE_KEY ? TURNSTILE_TEST_SECRET : '');
  if (!secret) return null;
  // 照合の緩和は sitekey と secret の両方がテストキーの組のときだけにする。
  // テスト secret が実 sitekey に残ると検証だけが緩んだまま動くため。
  return { secret, testing: secret === TURNSTILE_TEST_SECRET && env.TURNSTILE_SITE_KEY === TURNSTILE_TEST_SITE_KEY };
}

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
}

/** cf-turnstile-response トークンを siteverify で検証する。原稿・APIキーは送らない。 */
export async function verifyTurnstile(input: TurnstileCheck, env: TurnstileEnv, fetcher: HttpFetch = fetch): Promise<TurnstileResult> {
  const resolved = resolveSecret(env);
  if (!resolved) return { ok: false, status: 503, error: '人間性の確認の設定がまだ完了していません' };
  if (!input.token || input.token.length > MAX_TOKEN_LENGTH) return { ok: false, status: 403, error: REJECTED };
  let result: SiteverifyResponse;
  try {
    const response = await fetchWithoutRedirects(fetcher, SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: resolved.secret,
        response: input.token,
        ...(input.remoteip ? { remoteip: input.remoteip } : {}),
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`siteverify status ${response.status}`);
    result = await response.json();
  } catch {
    // 確認サービスの障害・タイムアウトは校閲失敗ではなく再試行可能な503として扱う
    return { ok: false, status: 503, error: '確認サービスへの接続に失敗しました。時間を置いて再試行してください' };
  }
  if (result.success !== true) {
    // error-codes は Cloudflare が定める固定の列挙値で、利用者の情報を含まない
    console.warn({ event: 'turnstile_verification_failed', reason: 'rejected', codes: result['error-codes'] });
    return { ok: false, status: 403, error: REJECTED };
  }
  if (!resolved.testing && (result.hostname !== input.hostname || result.action !== TURNSTILE_ACTION || result.cdata)) {
    console.warn({ event: 'turnstile_verification_failed', reason: 'mismatch' });
    return { ok: false, status: 403, error: REJECTED };
  }
  return { ok: true };
}

/**
 * Turnstile widget のホストページ。拡張の side panel は MV3 の CSP で remote script を読めず、
 * note の content script に埋めるとページ側 CSP の frame-src に遮られるため、API オリジンが配る。
 * トークンは execute を送った親オリジンにだけ postMessage で返す。
 */
export function turnstilePage(sitekey: string, nonce: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>minaosi</title>
<style>html,body{margin:0;height:100%;background:transparent}</style>
</head>
<body>
<div id="t"></div>
<script nonce="${nonce}">
'use strict';
var replyOrigin = null;
var widget = null;
var pendingExecute = false;
function report(payload) {
  if (replyOrigin !== null && parent !== window) {
    parent.postMessage(Object.assign({ type: 'minaosi-turnstile' }, payload), replyOrigin);
  }
}
window.minaosiTurnstileOnload = function () {
  // 拡張以外のページへ埋め込まれた場合は widget を発行しない。
  // frame-ancestors が効かない経路への保険として ancestorOrigins でも確認する。
  var ancestors = location.ancestorOrigins;
  // ancestorOrigins は Chromium 系のみ。Firefox では iframe の referrer が埋め込み元になる
  var embedder = ancestors && ancestors.length ? ancestors[ancestors.length - 1] : (document.referrer || '');
  if (embedder && !embedder.split(':')[0].endsWith('-extension')) return;
  widget = turnstile.render('#t', {
    sitekey: ${JSON.stringify(sitekey)},
    action: ${JSON.stringify(TURNSTILE_ACTION)},
    execution: 'execute',
    appearance: 'interaction-only',
    'feedback-enabled': false,
    callback: function (token) { report({ event: 'token', token: token }); },
    'error-callback': function () { report({ event: 'error' }); },
    'expired-callback': function () { report({ event: 'expired' }); },
    'timeout-callback': function () { report({ event: 'timeout' }); },
    'unsupported-callback': function () { report({ event: 'unsupported' }); },
    'before-interactive-callback': function () { report({ event: 'interactive', interactive: true }); },
    'after-interactive-callback': function () { report({ event: 'interactive', interactive: false }); }
  });
  if (pendingExecute) { turnstile.execute(widget); }
  // 初期化完了の通知だけはオリジン不特定で返す（execute 前は replyOrigin が未確定のため）。
  // ready には秘密情報を含めない。
  if (parent !== window) parent.postMessage({ type: 'minaosi-turnstile', event: 'ready' }, '*');
};
addEventListener('message', function (e) {
  if (e.source !== parent || !e.data || e.data.type !== 'minaosi-turnstile') return;
  if (replyOrigin === null) replyOrigin = e.origin;
  if (e.origin !== replyOrigin || e.data.event !== 'execute') return;
  if (widget === null) { pendingExecute = true; return; }
  turnstile.reset(widget);
  turnstile.execute(widget);
});
</script>
<script nonce="${nonce}" src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=minaosiTurnstileOnload&render=explicit" async defer></script>
</body>
</html>`;
}
