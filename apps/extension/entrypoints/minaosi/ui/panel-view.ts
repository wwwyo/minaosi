import { renderPanel, type PanelState } from './panel';

/** 原稿の状態更新でも、変わらない指摘とスクロール位置を維持する。 */
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
  const list = current.querySelector('.list')!;
  const nextList = next.querySelector('.list')!;
  if (list.innerHTML === nextList.innerHTML) return;
  const scrollTop = list.scrollTop;
  list.replaceChildren(...nextList.childNodes);
  list.scrollTop = scrollTop;
}
