import type { HttpFetch } from '../schema';
import { decodeHTML } from 'entities';

const MAX_PAGE_BYTES = 524_288;
const FETCH_TIMEOUT_MS = 12_000;

/** 検索結果から取得するURLを、認証なしの公開HTTPSサイトに限定する。 */
export function publicUrl(input: string): URL {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') ||
      /(^|\.)(localhost|local|localdomain|internal|lan|home|test|invalid)$/.test(host) || host.endsWith('.home.arpa')) {
    throw new Error('取得できないURLです');
  }
  url.hash = '';
  return url;
}

/** 宣言サイズを信用せず、受信した本文にも上限を設ける。 */
export async function boundedText(response: Response, signal?: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('本文がありません');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    signal?.throwIfAborted();
    if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) throw new Error('本文が大きすぎます');
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new Error('本文が大きすぎます');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel();
  }
}

/** 各リダイレクト先を検証し、待機時間と受信量を制限して取得する。 */
export async function fetchPage(input: string, fetcher: HttpFetch, init?: RequestInit): Promise<{ url: string; text: string; contentType: string }> {
  let url = publicUrl(input);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetcher(url, { ...init, redirect: 'manual', credentials: 'omit', signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || hop === 3) throw new Error('リダイレクトを取得できません');
      url = publicUrl(new URL(location, url).href);
      // 取得元に指定されたヘッダーをリダイレクト先へ引き継がない。
      init = undefined;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('ページを取得できません');
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/i.test(contentType)) {
      await response.body?.cancel();
      throw new Error('対応していない本文形式です');
    }
    return { url: url.href, text: await boundedText(response), contentType };
  }
  throw new Error('ページを取得できません');
}

export const normalizeText = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

/** HTMLの本文から、スクリプトなどを除いた出典照合用テキストを取り出す。 */
export async function pageText(html: string): Promise<string> {
  let excluded = 0;
  const parts: string[] = [];
  const rewriter = new HTMLRewriter()
    .on('script, style, nav, header, footer, noscript, template', {
      element(element) {
        excluded++;
        element.onEndTag(() => { excluded--; });
      },
    })
    .on('p, li, h1, h2, h3, h4, td, th, br, article, section', {
      element(element) {
        if (!excluded) parts.push(' ');
        // brなど終端タグを持たない要素でonEndTagを呼ぶと、出典本文の取得全体が失敗する。
        if (element.tagName !== 'br') element.onEndTag(() => { if (!excluded) parts.push(' '); });
      },
    })
    .on('body', { text(chunk) { if (!excluded) parts.push(chunk.text); } });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return normalizeText(decodeHTML(parts.join(''))).slice(0, 24_000);
}
