import { browser } from '#imports';
import { isReviewProvider, review, type ReviewRequest } from './minaosi/review/providers';
import { PROVIDER_SETTINGS } from './minaosi/store';
import { TurnstileGate, TurnstileInteractionRequired } from './minaosi/turnstile';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。Gateway の認証情報は
 * 校閲サーバーに置き、拡張には配布しない。
 */

interface TurnstileAcquireReply {
  token?: string;
  /** widget が人の対話を要求した。呼び出し側は blocked 状態にして静かに待つ。 */
  interactive?: boolean;
  error?: string;
}

interface OffscreenApi {
  createDocument(opts: { url: string; reasons: string[]; justification: string }): Promise<void>;
}

export default defineBackground(() => {
  /**
   * 自動校閲用の確認トークンを非表示で取る。DOM を持つ background(event page: Firefox)は
   * 自身に widget の iframe を載せ、DOM を持たない service worker(Chrome)は offscreen
   * document へ転送する。widget が対話を要求した場合は interactive を返す。
   */
  let hiddenGate: TurnstileGate | null = null;
  let creatingOffscreen: Promise<void> | null = null;
  const acquireTurnstile = async (): Promise<TurnstileAcquireReply> => {
    const endpoint = import.meta.env.WXT_REVIEW_API_URL ?? '';
    if (!endpoint) return { error: '校閲サーバーの接続先が設定されていません' };
    hiddenGate ??= typeof document !== 'undefined' ? TurnstileGate.fromReviewEndpoint(endpoint, { interactive: false }) : null;
    if (hiddenGate) {
      try {
        return { token: await hiddenGate.acquire() };
      } catch (e) {
        return e instanceof TurnstileInteractionRequired
          ? { interactive: true }
          : { error: e instanceof Error ? e.message : String(e) };
      }
    }
    const offscreen = (browser as unknown as { offscreen?: OffscreenApi }).offscreen;
    const runtime = browser.runtime as typeof browser.runtime & {
      getContexts?(filter: { contextTypes: string[] }): Promise<unknown[]>;
    };
    if (!offscreen || !runtime.getContexts) return { error: 'このブラウザでは自動校閲の確認を実行できません' };
    try {
      if ((await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length === 0) {
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
        if (reply) return reply as TurnstileAcquireReply;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { error: '人間性の確認を実行できません' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
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
    if (msg?.type === 'minaosi:acquire-turnstile') {
      // widget の応答待ちに service worker が idle 終了しないよう API call で生存を維持する
      const keepalive = setInterval(() => {
        void browser.runtime.getPlatformInfo();
      }, 20_000);
      void acquireTurnstile()
        .then(sendResponse)
        .finally(() => clearInterval(keepalive));
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
