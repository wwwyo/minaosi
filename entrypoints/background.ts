import { browser } from '#imports';
import { isReviewProvider, review, type ReviewRequest } from './minaosi/review/providers';
import { PROVIDER_SETTINGS } from './minaosi/store';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。Gateway の認証情報は
 * 校閲サーバーに置き、拡張には配布しない。
 */

export default defineBackground(() => {
  const sidebar = (browser as typeof browser & { sidebarAction: { open(): Promise<void> } }).sidebarAction;
  if (import.meta.env.BROWSER !== 'firefox') {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    browser.action.onClicked.addListener(() => { void sidebar.open(); });
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'minaosi:open-panel' && sender.tab?.windowId !== undefined) {
      const opening = import.meta.env.BROWSER === 'firefox'
        ? sidebar.open()
        : browser.sidePanel.open({ windowId: sender.tab.windowId });
      void opening.then(() => sendResponse({ ok: true }), (error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (!msg || msg.type !== 'minaosi:review') return undefined;
    const request = msg as ReviewRequest;
    void (async () => {
      // 応答待ちの間 service worker が idle 終了しないよう API call で生存を維持する
      const keepalive = setInterval(() => {
        void browser.runtime.getPlatformInfo();
      }, 20_000);
      try {
        if (!isReviewProvider(request.provider)) throw new Error('未対応の接続先です');
        const apiKey = await PROVIDER_SETTINGS[request.provider].key.getValue();
        const endpoint = import.meta.env.WXT_REVIEW_API_URL;
        if (!endpoint) throw new Error('校閲サーバーの接続先が設定されていません');
        if (!apiKey) throw new Error('API key を設定してください');
        const findings = await review(request, apiKey, endpoint);
        sendResponse({ ok: true, findings });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(keepalive);
      }
    })();
    return true;
  });
});
