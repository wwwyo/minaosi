import { browser } from '#imports';

/**
 * 原稿の外部送信は background で行う（content script からの fetch は
 * ページの CSP connect-src に従うため）。BYOK: key は設定 pane で
 * 登録した値を content 側から渡され、ここには保存しない。
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/** web_search を挟む校閲は長引くことがあるので、pause_turn の継続を数回まで追う */
const MAX_CONTINUATIONS = 4;

interface AnthropicResponse {
  stop_reason?: string;
  content?: unknown;
  error?: { message?: string };
}

async function post(apiKey: string, body: Record<string, unknown>): Promise<{ status: number; data: AnthropicResponse | null }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as AnthropicResponse | null;
  return { status: res.status, data };
}

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
    const { apiKey, body } = msg as { apiKey: string; body: Record<string, unknown> };
    void (async () => {
      // 応答待ちの間 service worker が idle 終了しないよう API call で生存を維持する
      const keepalive = setInterval(() => {
        void browser.runtime.getPlatformInfo();
      }, 20_000);
      try {
        let messages = (body.messages as unknown[]) ?? [];
        let reply: { status: number; data: AnthropicResponse | null } | null = null;
        for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
          reply = await post(apiKey, { ...body, messages });
          if (reply.status < 200 || reply.status >= 300) break;
          if (reply.data?.stop_reason === 'pause_turn' && Array.isArray(reply.data.content)) {
            messages = [...messages, { role: 'assistant', content: reply.data.content }];
            continue;
          }
          break;
        }
        if (!reply) throw new Error('no response');
        sendResponse({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, data: reply.data });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(keepalive);
      }
    })();
    return true;
  });
});
