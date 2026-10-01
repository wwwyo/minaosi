import { browser } from '#imports';
import { PanelConnection } from '../minaosi/panel-connection';
import { TurnstileGate } from '../minaosi/turnstile';
import { wirePanel } from '../minaosi/ui/panel';
import { updatePanel } from '../minaosi/ui/panel-view';
import { PANEL_CSS } from '../minaosi/ui/styles';

const root = document.querySelector<HTMLElement>('#panel-root')!;
const style = document.createElement('style');
style.textContent = `${PANEL_CSS}\nhtml, body { margin: 0; background: transparent; }`;
document.head.append(style);

let selectedId: string | null = null;
const connection = new PanelConnection(
  (tabId, name) => browser.tabs.connect(tabId, { name }),
  (state) => {
    if (!state) { selectedId = null; showUnavailable(); return; }
    updatePanel(root, state);
    if (state.selectedId !== selectedId) {
      selectedId = state.selectedId;
      root.querySelector('.n-item[data-sel]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  },
  () => { void browser.runtime.lastError; },
);
const send = connection.send.bind(connection);

// 「見直す」の前に人間性の確認トークンを取る。widget は校閲サーバーの /turnstile を
// iframe で開き、postMessage でトークンを受け取る（詳細は docs/review-gateway.md）。
const turnstile = TurnstileGate.fromReviewEndpoint(import.meta.env.WXT_REVIEW_API_URL ?? '');
async function runReview() {
  if (!turnstile) {
    send({ action: 'run', turnstile: { error: '校閲サーバーの接続先が設定されていません' } });
    return;
  }
  try {
    send({ action: 'run', turnstile: { token: await turnstile.acquire() } });
  } catch (e) {
    send({ action: 'run', turnstile: { error: e instanceof Error ? e.message : String(e) } });
  }
}

function showUnavailable() {
  root.dataset.view = '';
  root.innerHTML = '<div class="mn"><div class="empty">noteの原稿編集画面を開いてください</div></div>';
}

wirePanel(root, {
  onRun: () => { void runReview(); },
  onFilter: (filter) => send({ action: 'filter', filter }),
  onSelect: (id) => send({ action: 'select', id }),
  onApplyFinding: (id) => send({ action: 'apply', id }),
  onDelete: (id) => send({ action: 'delete', id }),
  onRevert: (id) => send({ action: 'revert', id }),
});

const onContentReady: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
  if (message?.type === 'minaosi:content-ready') connection.contentReady(sender.tab?.id);
};
browser.runtime.onMessage.addListener(onContentReady);

const currentWindow = await browser.windows.getCurrent();
const onVisibility: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender, sendResponse) => {
  if (sender.id === browser.runtime.id && message?.type === 'minaosi:panel-visibility' && message.windowId === currentWindow.id) {
    sendResponse({ open: document.visibilityState === 'visible' });
  }
};
browser.runtime.onMessage.addListener(onVisibility);
browser.tabs.onActivated.addListener(({ tabId: id, windowId }) => {
  if (windowId === currentWindow.id) connection.connectToTab(id);
});
browser.tabs.onUpdated.addListener((id, change) => {
  if (id === connection.activeTabId && change.status === 'complete') connection.connectToTab(id);
});
const [active] = await browser.tabs.query({ active: true, windowId: currentWindow.id });
connection.connectToTab(active?.id);
window.addEventListener('pagehide', () => {
  turnstile?.dispose();
  browser.runtime.onMessage.removeListener(onVisibility);
  browser.runtime.onMessage.removeListener(onContentReady);
  connection.dispose();
});
