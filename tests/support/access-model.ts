import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ACCESS_MODEL = 'workers-ai/@cf/google/gemma-4-26b-a4b-it';
export const REQUEST_LIMIT = 60;
const execFileAsync = promisify(execFile);
const SDK_BASE = 'https://access.invalid/compat';
const LOGIN_HINT = 'Run cloudflared access login --quiet with CF_AI_ACCESS_URL through mise in a human terminal, then retry.';

export class AccessError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'AccessError';
  }
}

export function accessEndpoint(value = process.env.CF_AI_ACCESS_URL): string {
  if (!value) throw new AccessError('ACCESS_URL_MISSING', 'CF_AI_ACCESS_URL is required; run through mise with age decryption enabled.');
  let url: URL;
  try { url = new URL(value); } catch { throw new AccessError('ACCESS_URL_INVALID', 'Expected an HTTPS compat/chat/completions URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith('/compat/chat/completions')) {
    throw new AccessError('ACCESS_URL_INVALID', 'Expected an HTTPS compat/chat/completions URL without credentials, query or fragment.');
  }
  return url.href;
}

/** token only reads cloudflared's existing session; unlike access curl it never starts login. */
export async function accessSession(endpoint: string, signal?: AbortSignal): Promise<string> {
  let jwt: string;
  try {
    const result = await execFileAsync('cloudflared', ['access', 'token', '--app', endpoint], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeout: 5_000, maxBuffer: 64 * 1024, signal,
    });
    jwt = result.stdout.trim();
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new AccessError('ACCESS_SESSION_MISSING', LOGIN_HINT);
  }
  let exp: unknown;
  try {
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt)) throw new Error();
    exp = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).exp;
  } catch {
    throw new AccessError('ACCESS_SESSION_INVALID', LOGIN_HINT);
  }
  // This is a local expiry check, not signature verification; Access verifies the credential at the edge.
  if (typeof exp !== 'number' || exp * 1000 <= Date.now() + 60_000) {
    throw new AccessError('ACCESS_SESSION_EXPIRED', LOGIN_HINT);
  }
  return jwt;
}

/** The SDK sees a placeholder URL and no auth headers, including in its errors and AI traces. */
export function accessFetch(endpoint: string): typeof fetch {
  let requests = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) !== `${SDK_BASE}/chat/completions` || init?.method !== 'POST' || typeof init.body !== 'string') {
      throw new AccessError('ACCESS_REQUEST_INVALID', 'Only non-streaming chat completions are supported.');
    }
    const body = JSON.parse(init.body);
    if (body.stream) throw new AccessError('ACCESS_REQUEST_INVALID', 'Streaming is not enabled for this E2E transport.');
    if (++requests > REQUEST_LIMIT) throw new AccessError('ACCESS_REQUEST_LIMIT', 'The worker exhausted its 60 HTTP model requests, including SDK retries.');
    body.max_tokens = Math.min(body.max_tokens ?? 2048, 2048);
    const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(init.signal ? [init.signal] : [])]);
    const jwt = await accessSession(endpoint, signal);
    const headers = new Headers({ 'content-type': 'application/json', 'cf-access-token': jwt });
    let response: Response;
    let text: string;
    try {
      response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal });
      if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        throw new AccessError('ACCESS_DENIED', LOGIN_HINT);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AccessError('ACCESS_MODEL_HTTP', `Model endpoint returned HTTP ${response.status}; check model support and Gateway availability.`);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw new AccessError('ACCESS_RESPONSE_INVALID', 'Expected model JSON, not a login page.');
      }
      text = await response.text();
    } catch (error) {
      if (error instanceof AccessError) throw error;
      if (init.signal?.aborted) throw new AccessError('ACCESS_CANCELLED', 'Model request cancelled.');
      throw new AccessError('ACCESS_NETWORK_FAILED', 'Model request failed or exceeded 60 seconds.');
    }
    // Never forward upstream error bodies, headers, or the actual response URL to the SDK.
    const safeText = text.replaceAll(endpoint, '[access-url]').replaceAll(new URL(endpoint).host, '[access-host]').replaceAll(jwt, '[access-session]');
    let payload: { choices?: unknown[] };
    try { payload = JSON.parse(safeText); } catch { throw new AccessError('ACCESS_RESPONSE_INVALID', 'Expected valid model JSON.'); }
    if (!Array.isArray(payload?.choices) || payload.choices.length === 0) {
      throw new AccessError('ACCESS_RESPONSE_INVALID', 'Expected non-empty model choices.');
    }
    return new Response(safeText, { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

export function accessModel() {
  return createOpenAICompatible({
    name: 'cloudflare-access', baseURL: SDK_BASE,
    fetch: accessFetch(accessEndpoint()), supportsStructuredOutputs: true,
  })(ACCESS_MODEL);
}
