import { genericAdapter } from './minaosi/surfaces/generic';
import { Controller } from './minaosi/controller';
import { PANEL_PORT, type PanelCommand, type PanelUpdate } from './minaosi/panel-messages';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: false,
  runAt: 'document_idle',
  main(ctx) {
    let ctrl: Controller | null = null;
    let editor: HTMLElement | null = null;
    const ports = new Set<Browser.runtime.Port>();
    const publish = (state: PanelUpdate['state']) => {
      for (const port of ports) port.postMessage({ type: 'state', state } satisfies PanelUpdate);
    };

    const check = () => {
      const found = genericAdapter.findEditor(document);
      if (found && (!ctrl || found !== editor)) {
        // 同じblock indexでも別の原稿を指しうるため、指摘を新しいrootへ引き継がない。
        ctrl?.dispose();
        editor = found;
        ctrl = new Controller(genericAdapter, found, publish);
        void ctrl.init();
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
      port.onMessage.addListener((command: PanelCommand) => {
        const current = ctrl;
        check();
        if (current && current === ctrl) current.handleCommand(command);
      });
      port.onDisconnect.addListener(() => ports.delete(port));
      port.postMessage({ type: 'state', state: ctrl?.snapshot() ?? null } satisfies PanelUpdate);
    };
    browser.runtime.onConnect.addListener(onConnect);

    check();
    // 先行接続したpaneにはonConnectが届かないため、登録完了後に接続し直してもらう。
    void browser.runtime.sendMessage({ type: 'minaosi:content-ready' }).catch(() => {});
    // 属性や周辺操作の変化も再判定するため、検出したrootだけの監視には限定しない。
    ctx.setInterval(check, 3000);
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      ctrl?.dispose();
      ctrl = null;
      editor = null;
      publish(null);
      check();
    });
    ctx.onInvalidated(() => {
      ctrl?.dispose();
      ctrl = null;
      browser.runtime.onConnect.removeListener(onConnect);
      for (const port of ports) port.disconnect();
      ports.clear();
    });
  },
});
