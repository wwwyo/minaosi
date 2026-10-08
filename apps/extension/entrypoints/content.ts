import { genericAdapter } from './minaosi/surfaces/generic';
import { selectReviewEditor, type EditorDetection } from './minaosi/surfaces/types';
import { Controller } from './minaosi/controller';
import { PANEL_PORT, type PanelCommand, type PanelUpdate } from './minaosi/panel-messages';
import { initialReviewState } from './minaosi/ui/panel';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: false,
  runAt: 'document_idle',
  main(ctx) {
    let ctrl: Controller | null = null;
    let editor: HTMLElement | null = null;
    let editorId: string | null = null;
    let detection: EditorDetection = { status: 'none' };
    const ports = new Set<Browser.runtime.Port>();
    const snapshot = (): NonNullable<PanelUpdate['state']> => ({
      ...(ctrl?.snapshot() ?? initialReviewState()),
      editorStatus: detection.status,
      canReview: ctrl !== null,
      editorId,
    });
    const publish = () => {
      const state = snapshot();
      for (const port of ports) port.postMessage({ type: 'state', state } satisfies PanelUpdate);
    };

    const check = () => {
      const previousStatus = detection.status;
      const previousEditor = editor;
      detection = genericAdapter.detectEditor(document);
      const found = selectReviewEditor(detection, 'manual');
      if (found && (!ctrl || found !== editor)) {
        // 別の原稿へ指摘を引き継がず、手動実行の候補を自動校閲の許可に変えない。
        ctrl?.dispose();
        editor = found;
        editorId = crypto.getRandomValues(new Uint32Array(4)).join('-');
        ctrl = new Controller(genericAdapter, found, publish);
        void ctrl.init();
      } else if (!found && ctrl) {
        ctrl.dispose();
        ctrl = null;
        editor = null;
        editorId = null;
      }
      if (previousStatus !== detection.status || previousEditor !== editor) publish();
    };

    const onConnect = (port: Browser.runtime.Port) => {
      if (port.name !== PANEL_PORT || port.sender?.id !== browser.runtime.id) return;
      ports.add(port);
      port.onMessage.addListener((command: PanelCommand) => {
        const current = ctrl;
        check();
        if (command.action === 'run' && command.editorId !== editorId) return;
        if (command.action === 'run' && command.trigger === 'automatic' && detection.status !== 'confirmed') return;
        if (current && current === ctrl) current.handleCommand(command);
      });
      port.onDisconnect.addListener(() => ports.delete(port));
      port.postMessage({ type: 'state', state: snapshot() } satisfies PanelUpdate);
    };
    browser.runtime.onConnect.addListener(onConnect);

    check();
    void browser.runtime.sendMessage({ type: 'minaosi:content-ready' }).catch(() => {});
    ctx.setInterval(check, 3000);
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      ctrl?.dispose();
      ctrl = null;
      editor = null;
      editorId = null;
      check();
      publish();
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
