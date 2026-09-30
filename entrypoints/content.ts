import { noteAdapter } from './minaosi/surfaces/note';
import { Controller } from './minaosi/controller';
import { PANEL_PORT, type PanelCommand, type PanelUpdate } from './minaosi/panel-messages';

export default defineContentScript({
  matches: ['*://editor.note.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let ctrl: Controller | null = null;
    let editor: HTMLElement | null = null;
    const ports = new Set<Browser.runtime.Port>();
    const publish = (state: PanelUpdate['state']) => {
      for (const port of ports) port.postMessage({ type: 'state', state } satisfies PanelUpdate);
    };

    const check = () => {
      const found = noteAdapter.findEditor(document);
      if (found && !ctrl) {
        editor = found;
        ctrl = new Controller(noteAdapter, found, publish);
        void ctrl.init();
      } else if (found && found !== editor) {
        // SPA 遷移やエディタの再描画で root が入れ替わった場合は監視対象だけ差し替える
        editor = found;
        ctrl?.setEditor(found);
      } else if (!found && ctrl) {
        ctrl.dispose();
        ctrl = null;
        editor = null;
        publish(null);
      }
    };

    const onConnect = (port: Browser.runtime.Port) => {
      if (port.name !== PANEL_PORT || port.sender?.id !== browser.runtime.id) return;
      ports.add(port);
      port.onMessage.addListener((command: PanelCommand) => ctrl?.handleCommand(command));
      port.onDisconnect.addListener(() => ports.delete(port));
      port.postMessage({ type: 'state', state: ctrl?.snapshot() ?? null } satisfies PanelUpdate);
    };
    browser.runtime.onConnect.addListener(onConnect);

    check();
    // エディタの遅延描画・SPA 遷移を拾う。見つかってからも軽い querySelectorAll を定期実行するだけ
    ctx.setInterval(check, 3000);
    ctx.addEventListener(window, 'wxt:locationchange', check);
    ctx.onInvalidated(() => {
      ctrl?.dispose();
      ctrl = null;
      browser.runtime.onConnect.removeListener(onConnect);
      for (const port of ports) port.disconnect();
      ports.clear();
    });
  },
});
