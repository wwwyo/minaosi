import { renderPanel, type PanelState } from './panel';

/** 設定の選択範囲・入力フォーカスは、本文側の状態更新でも維持する。 */
export function updatePanel(root: HTMLElement, state: PanelState) {
  const template = document.createElement('template');
  template.innerHTML = renderPanel(state);
  const next = template.content.firstElementChild as HTMLElement;
  const current = root.firstElementChild;
  if (!current || root.dataset.view !== state.view) {
    root.replaceChildren(next);
    root.dataset.view = state.view;
    return;
  }

  const header = current.querySelector('header')!;
  const nextHeader = next.querySelector('header')!;
  if (header.outerHTML !== nextHeader.outerHTML) header.replaceWith(nextHeader);

  // 設定は view を開いたときに構築する。原稿の状態更新で入力途中の値を上書きしない。
  if (state.view !== 'list') return;
  const list = current.querySelector('.list')!;
  const nextList = next.querySelector('.list')!;
  if (list.innerHTML === nextList.innerHTML) return;
  const scrollTop = list.scrollTop;
  list.replaceChildren(...nextList.childNodes);
  list.scrollTop = scrollTop;
}
