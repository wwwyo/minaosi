import { browser } from '#imports';
import { review, type ReviewRequest } from './minaosi/review/providers';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。BYOK: key は設定 pane で
 * 登録した値を content 側から渡され、ここには保存しない。
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
        const findings = await review(request);
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
