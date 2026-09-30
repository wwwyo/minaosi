import { browser } from '#imports';
import { PanelConnection } from '../minaosi/panel-connection';
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
});

const onContentReady: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
  if (message?.type === 'minaosi:content-ready') connection.contentReady(sender.tab?.id);
};
browser.runtime.onMessage.addListener(onContentReady);

const currentWindow = await browser.windows.getCurrent();
browser.tabs.onActivated.addListener(({ tabId: id, windowId }) => {
  if (windowId === currentWindow.id) connection.connectToTab(id);
});
browser.tabs.onUpdated.addListener((id, change) => {
  if (id === connection.activeTabId && change.status === 'complete') connection.connectToTab(id);
});
const [active] = await browser.tabs.query({ active: true, windowId: currentWindow.id });
connection.connectToTab(active?.id);
window.addEventListener('pagehide', () => {
  browser.runtime.onMessage.removeListener(onContentReady);
  connection.dispose();
});
