import { browser } from '#imports';
import { isReviewProvider, review, type ReviewMode, type ReviewProvider, type ReviewRequest } from './minaosi/review/providers';
import { PROVIDER_SETTINGS, providerItem, restrictStorageToTrustedContexts, reviewModeItem } from './minaosi/store';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。Gateway の認証情報は
 * 校閲サーバーに置き、拡張には配布しない。
 */

export default defineBackground(() => {
  // BYOKキー等を含む storage.local を trusted context に限定する（ADR 0004）。
  // content script 側は設定値を直接読まず、下の get-review-config 経由で受け取る。
  void restrictStorageToTrustedContexts();

  /** 信頼できるコンテキストで設定を読み、content script へ渡す非秘密の設定だけを返す。 */
  const readReviewConfig = async (): Promise<{ mode: ReviewMode; provider: ReviewProvider; model: string; hasKey: boolean }> => {
    const [mode, storedProvider] = await Promise.all([reviewModeItem.getValue(), providerItem.getValue()]);
    const provider = isReviewProvider(storedProvider) ? storedProvider : 'anthropic';
    const settings = PROVIDER_SETTINGS[provider];
    const [apiKey, model] = await Promise.all([settings.key.getValue(), settings.model.getValue()]);
    return { mode: mode === 'byok' ? 'byok' : 'default', provider, model, hasKey: apiKey.length > 0 };
  };

  /** 設定変更を content script へ通知する（content 側は storage を watch しない）。 */
  const broadcastConfigChanged = () => {
    void browser.tabs.query({}).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'minaosi:review-config-changed' }).catch(() => {});
      }
    });
  };
  reviewModeItem.watch(broadcastConfigChanged);
  providerItem.watch(broadcastConfigChanged);
  for (const settings of Object.values(PROVIDER_SETTINGS)) {
    settings.key.watch(broadcastConfigChanged);
    settings.model.watch(broadcastConfigChanged);
  }
  const sidebar = (browser as typeof browser & { sidebarAction: { toggle(): Promise<void> } }).sidebarAction;
  if (import.meta.env.BROWSER !== 'firefox') {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    const notify = (windowId: number, open: boolean) => {
      void browser.tabs.query({ windowId }).then((tabs) => {
        for (const tab of tabs) {
          if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, { type: 'minaosi:panel-state', open }).catch(() => {});
        }
      });
    };
    browser.sidePanel.onOpened.addListener(({ windowId }) => notify(windowId, true));
    browser.sidePanel.onClosed.addListener(({ windowId }) => notify(windowId, false));
  } else {
    browser.action.onClicked.addListener(() => { void sidebar.toggle(); });
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'minaosi:get-panel-state' && sender.tab?.windowId !== undefined && import.meta.env.BROWSER !== 'firefox') {
      const windowId = sender.tab.windowId;
      // 別paneへの切り替え後もcontextが残ることがあるため、存在だけで開いていると判定しない。
      void browser.runtime.sendMessage({ type: 'minaosi:panel-visibility', windowId })
        .then(sendResponse, () => sendResponse({ open: false }));
      return true;
    }
    if (msg?.type === 'minaosi:toggle-panel' && sender.tab?.windowId !== undefined && typeof msg.open === 'boolean') {
      const toggling = import.meta.env.BROWSER === 'firefox'
        ? sidebar.toggle()
        : msg.open
          ? browser.sidePanel.open({ windowId: sender.tab.windowId })
          : browser.sidePanel.close({ windowId: sender.tab.windowId });
      void toggling.then(() => sendResponse({ ok: true }), (error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (msg?.type === 'minaosi:review-config-changed') return undefined;
    if (msg?.type === 'minaosi:get-review-config') {
      // キーの実値は渡さず、有無だけを返す。送信時のキーは background が改めて読む。
      void readReviewConfig().then(
        (config) => sendResponse({ ok: true, ...config }),
        () => sendResponse({ ok: false }),
      );
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
        if (request.mode !== undefined && request.mode !== 'default' && request.mode !== 'byok') throw new Error('校閲モードが不正です');
        if (request.mode !== 'default' && !isReviewProvider(request.provider)) throw new Error('未対応の接続先です');
        const apiKey = request.mode === 'default' ? '' : await PROVIDER_SETTINGS[request.provider].key.getValue();
        const endpoint = import.meta.env.WXT_REVIEW_API_URL;
        if (!endpoint) throw new Error('校閲サーバーの接続先が設定されていません');
        if (request.mode !== 'default' && !apiKey) throw new Error('拡張機能のオプションでAPIキーを登録してください');
        const result = await review(request, apiKey, endpoint);
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(keepalive);
      }
    })();
    return true;
  });
});
