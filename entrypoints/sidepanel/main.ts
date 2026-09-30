import { browser } from '#imports';
import { PANEL_PORT, type PanelCommand, type PanelUpdate } from '../minaosi/panel-messages';
import { wirePanel } from '../minaosi/ui/panel';
import { updatePanel } from '../minaosi/ui/panel-view';
import { PANEL_CSS } from '../minaosi/ui/styles';

const root = document.querySelector<HTMLElement>('#panel-root')!;
const style = document.createElement('style');
style.textContent = `${PANEL_CSS}\nhtml, body { margin: 0; background: transparent; }`;
document.head.append(style);

let port: ReturnType<typeof browser.tabs.connect> | null = null;
let tabId: number | undefined;
let selectedId: string | null = null;
let connection = 0;

function send(command: PanelCommand) {
  port?.postMessage(command);
}

function showUnavailable() {
  root.dataset.view = '';
  root.innerHTML = '<div class="mn"><div class="empty">noteの原稿編集画面を開いてください</div></div>';
}

wirePanel(root, {
  onRun: () => send({ action: 'run' }),
  onFilter: (filter) => send({ action: 'filter', filter }),
  onSelect: (id) => send({ action: 'select', id }),
  onApplyFinding: (id) => send({ action: 'apply', id }),
  onDelete: (id) => send({ action: 'delete', id }),
  onRevert: (id) => send({ action: 'revert', id }),
  onOpenSettings: () => send({ action: 'settings' }),
  onBackToList: () => send({ action: 'back' }),
  onSaveKey: (value) => send({ action: 'saveKey', value }),
  onClearKey: () => send({ action: 'clearKey' }),
  onSaveModel: (value) => send({ action: 'saveModel', value }),
  onSaveProvider: (provider) => send({ action: 'saveProvider', provider }),
  onConsentAndRun: () => send({ action: 'consent' }),
  onRetry: () => send({ action: 'run' }),
});

function connectToTab(id: number | undefined) {
  const generation = ++connection;
  port?.disconnect();
  port = null;
  tabId = id;
  selectedId = null;
  showUnavailable();
  if (id === undefined) return;

  // URL を読む tabs permission は不要。content script のあるタブだけ接続に応答する。
  const next = browser.tabs.connect(id, { name: PANEL_PORT });
  port = next;
  next.onMessage.addListener((update: PanelUpdate) => {
    if (generation !== connection || update.type !== 'state') return;
    if (!update.state) { showUnavailable(); return; }
    updatePanel(root, update.state);
    if (update.state.selectedId !== selectedId) {
      selectedId = update.state.selectedId;
      root.querySelector('.n-item[data-sel]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  next.onDisconnect.addListener(() => {
    // 接続先に content script が無い場合の runtime.lastError を消費する。
    void browser.runtime.lastError;
    if (generation !== connection) return;
    port = null;
    showUnavailable();
  });
}

const currentWindow = await browser.windows.getCurrent();
browser.tabs.onActivated.addListener(({ tabId: id, windowId }) => {
  if (windowId === currentWindow.id) void connectToTab(id);
});
browser.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') void connectToTab(id);
});
const [active] = await browser.tabs.query({ active: true, windowId: currentWindow.id });
void connectToTab(active?.id);
window.addEventListener('pagehide', () => { ++connection; port?.disconnect(); });
