import { browser } from '#imports';
import { isReviewProvider, review, type ReviewMode, type ReviewProvider, type ReviewRequest } from './minaosi/review/providers';
import { PROVIDER_SETTINGS, providerItem, restrictStorageToTrustedContexts, reviewModeItem } from './minaosi/store';
import { TurnstileGate, acquireHiddenToken, type HiddenAcquireReply } from './minaosi/turnstile';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。Gateway の認証情報は
 * 校閲サーバーに置き、拡張には配布しない。
 */

interface OffscreenApi {
  createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

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

  /** 応答待ちの間 service worker が idle 終了しないよう API call で生存を維持する */
  const withKeepalive = <T>(p: Promise<T>): Promise<T> => {
    const keepalive = setInterval(() => {
      void browser.runtime.getPlatformInfo();
    }, 20_000);
    return p.finally(() => clearInterval(keepalive));
  };

  /**
   * 自動校閲用の確認トークンを非表示で取る。DOM を持つ background(event page: Firefox)は
   * 自身に widget の iframe を載せ、DOM を持たない service worker(Chrome)は offscreen
   * document へ転送する。widget が対話を要求した場合は interactive を返す。
   */
  let hiddenGate: TurnstileGate | null = null;
  let creatingOffscreen: Promise<void> | null = null;
  const doAcquire = async (): Promise<HiddenAcquireReply> => {
    const endpoint = import.meta.env.WXT_REVIEW_API_URL ?? '';
    if (!endpoint) return { error: '校閲サーバーの接続先が設定されていません' };
    hiddenGate ??= typeof document !== 'undefined' ? TurnstileGate.fromReviewEndpoint(endpoint, { interactive: false }) : null;
    if (hiddenGate) return acquireHiddenToken(hiddenGate);
    const offscreen = (browser as unknown as { offscreen?: OffscreenApi }).offscreen;
    const runtime = browser.runtime as typeof browser.runtime & {
      getContexts?(filter: { contextTypes: string[] }): Promise<{ documentUrl?: string }[]>;
    };
    if (!offscreen || !runtime.getContexts) return { error: 'このブラウザでは自動校閲の確認を実行できません' };
    try {
      // 別機能の offscreen document があっても自分の分は自分で作る（URL で判定）
      const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (!contexts.some((c) => c.documentUrl?.endsWith('/offscreen.html'))) {
        creatingOffscreen ??= offscreen
          .createDocument({
            url: 'offscreen.html',
            reasons: ['IFRAME_SCRIPTING'],
            justification: '校閲サーバーの人間性の確認を非表示で実行するため',
          })
          .finally(() => { creatingOffscreen = null; });
        await creatingOffscreen;
      }
      // offscreen 側の listener 登録が間に合わないことがあるため、無応答だけは限定的にやり直す
      for (let attempt = 0; attempt < 3; attempt++) {
        const reply = await browser.runtime.sendMessage({ type: 'minaosi:offscreen-turnstile' }).catch(() => undefined);
        if (reply) return reply as HiddenAcquireReply;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { error: '人間性の確認を実行できません' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  // widget は同時に1件しかトークンを出せないため、複数タブからの要求は直列化する
  let acquireTail: Promise<unknown> = Promise.resolve();
  const acquireTurnstile = (): Promise<HiddenAcquireReply> => {
    const next = acquireTail.then(() => doAcquire());
    acquireTail = next.then(() => undefined, () => undefined);
    return next;
  };

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
    if (msg?.type === 'minaosi:acquire-turnstile') {
      void withKeepalive(acquireTurnstile()).then(sendResponse);
      return true;
    }
    if (!msg || msg.type !== 'minaosi:review') return undefined;
    const request = msg as ReviewRequest;
    void withKeepalive((async () => {
      try {
        if (request.mode !== undefined && request.mode !== 'default' && request.mode !== 'byok') throw new Error('校閲モードが不正です');
        if (request.mode !== 'default' && !isReviewProvider(request.provider)) throw new Error('未対応の接続先です');
        const apiKey = request.mode === 'default' ? '' : await PROVIDER_SETTINGS[request.provider].key.getValue();
        const endpoint = import.meta.env.WXT_REVIEW_API_URL;
        if (!endpoint) throw new Error('校閲サーバーの接続先が設定されていません');
        if (request.mode !== 'default' && !apiKey) throw new Error('拡張機能のオプションでAPIキーを登録してください');
        const result = await review(request, apiKey, endpoint);
        return { ok: true, ...result };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })()).then(sendResponse);
    return true;
  });
});
