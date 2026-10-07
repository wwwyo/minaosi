import { browser } from '#imports';
import { TurnstileGate, TurnstileInteractionRequired } from '../minaosi/turnstile';

/**
 * Chrome MV3 の service worker には DOM が無いため、自動校閲用の人間性の確認は
 * この offscreen document に載せた /turnstile widget で行う。
 * 画面に出せないため、widget が対話を要求した場合は interactive を返して諦める
 * （書き手はパネル側の「見直す」経路で対話する）。
 */
const gate = TurnstileGate.fromReviewEndpoint(import.meta.env.WXT_REVIEW_API_URL ?? '', { interactive: false });

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'minaosi:offscreen-turnstile') return undefined;
  if (!gate) {
    sendResponse({ error: '校閲サーバーの接続先が設定されていません' });
    return undefined;
  }
  void gate.acquire().then(
    (token) => sendResponse({ token }),
    (e: unknown) =>
      sendResponse(
        e instanceof TurnstileInteractionRequired
          ? { interactive: true }
          : { error: e instanceof Error ? e.message : String(e) },
      ),
  );
  return true;
});
