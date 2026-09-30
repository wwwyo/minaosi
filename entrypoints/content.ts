import { noteAdapter } from './minaosi/surfaces/note';
import { Controller } from './minaosi/controller';

export default defineContentScript({
  matches: ['*://editor.note.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    let ctrl: Controller | null = null;
    let editor: HTMLElement | null = null;

    const check = () => {
      const found = noteAdapter.findEditor(document);
      if (found && !ctrl) {
        editor = found;
        ctrl = new Controller(noteAdapter, found);
        void ctrl.init();
      } else if (found && found !== editor) {
        // SPA 遷移やエディタの再描画で root が入れ替わった場合は監視対象だけ差し替える
        editor = found;
        ctrl?.setEditor(found);
      } else if (!found && ctrl) {
        ctrl.dispose();
        ctrl = null;
        editor = null;
      }
    };

    check();
    // エディタの遅延描画・SPA 遷移を拾う。見つかってからも軽い querySelectorAll を定期実行するだけ
    const timer = setInterval(check, 3000);
    ctx.addEventListener(window, 'wxt:locationchange', check);
    ctx.onInvalidated(() => {
      clearInterval(timer);
      ctrl?.dispose();
      ctrl = null;
    });
  },
});
