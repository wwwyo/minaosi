import { renderPanel, type PanelState } from './panel';

const MOTION = { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' };
const cards = (parent: Element) => [...parent.querySelectorAll<HTMLElement>('.n-item:not(.is-exiting)')];
const renderedLists = new WeakMap<HTMLElement, string>();
interface PreviousCard { card: HTMLElement; rect?: DOMRect; handled: boolean }

/** 指摘の DOM とスクロール位置を保ち、追加・対応・削除だけを動かす。 */
export function updatePanel(root: HTMLElement, state: PanelState, showHandled = false) {
  const template = document.createElement('template');
  template.innerHTML = renderPanel(state, showHandled);
  const next = template.content.firstElementChild as HTMLElement;
  const current = root.firstElementChild;
  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!current || root.dataset.view !== state.view) {
    root.replaceChildren(next);
    root.dataset.view = state.view;
    const list = next.querySelector<HTMLElement>('.list')!;
    renderedLists.set(list, list.innerHTML);
    if (motion) for (const card of cards(next)) enter(card);
    return;
  }

  // .auto-row は .list の外にあるため、list 本文の比較とは別に同期する
  const currentAuto = current.querySelector('.auto-row');
  const nextAuto = next.querySelector('.auto-row');
  if (currentAuto && nextAuto) {
    if (currentAuto.outerHTML !== nextAuto.outerHTML) currentAuto.replaceWith(nextAuto);
  } else if (nextAuto) {
    current.append(nextAuto);
  } else {
    currentAuto?.remove();
  }

  const list = current.querySelector<HTMLElement>('.list')!;
  const nextList = next.querySelector<HTMLElement>('.list')!;
  const ghosts = [...list.querySelectorAll<HTMLElement>('.is-exiting')];
  const markup = nextList.innerHTML;
  if (renderedLists.get(list) === markup) {
    return;
  }
  renderedLists.set(list, markup);

  const scrollTop = list.scrollTop;
  const oldCards = new Map(cards(list).map((card) => [card.dataset.fid!, {
    card, rect: motion ? card.getBoundingClientRect() : undefined, handled: !card.classList.contains('is-open'),
  }]));
  const listRect = motion ? list.getBoundingClientRect() : undefined;
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.closest<HTMLElement>('.n-item')?.dataset.fid;
  const focusedAction = focused?.dataset.act;
  const nextCards = cards(nextList);
  const exits: HTMLElement[] = [];
  const entering = new Set<HTMLElement>();
  for (const { card } of oldCards.values()) for (const animation of card.getAnimations()) animation.cancel();

  function exit(old: PreviousCard) {
    if (!old.rect || !listRect) return;
    const ghost = old.card.cloneNode(true) as HTMLElement;
    ghost.classList.add('is-exiting');
    ghost.removeAttribute('data-fid');
    ghost.removeAttribute('role');
    ghost.removeAttribute('tabindex');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    Object.assign(ghost.style, {
      top: `${old.rect.top - listRect.top + scrollTop}px`,
      left: `${old.rect.left - listRect.left}px`, width: `${old.rect.width}px`,
    });
    exits.push(ghost);
  }

  for (const card of nextCards) {
    const old = oldCards.get(card.dataset.fid!);
    if (!old) { entering.add(card); continue; }
    const movedSection = old.handled !== !card.classList.contains('is-open');
    if (movedSection) { exit(old); entering.add(old.card); }
    old.card.className = card.className;
    old.card.toggleAttribute('data-sel', card.hasAttribute('data-sel'));
    old.card.setAttribute('aria-expanded', card.getAttribute('aria-expanded')!);
    // 詳細を入れ直すと開閉の CSS transition が途切れるため、内容が変わった部分だけ更新する。
    for (const selector of ['.meta', '.ttl', '.detail-body', '.acts']) {
      const before = old.card.querySelector(selector)!;
      const after = card.querySelector(selector)!;
      if (before.innerHTML !== after.innerHTML) before.innerHTML = after.innerHTML;
    }
    old.card.querySelector<HTMLElement>('.detail')!.inert = !card.hasAttribute('data-sel');
  }
  const nextIds = new Set(nextCards.map((card) => card.dataset.fid));
  for (const [id, old] of oldCards) if (!nextIds.has(id)) exit(old);

  reconcile(list, nextList, oldCards);
  list.append(...exits);
  list.scrollTop = scrollTop;
  if (focused && list.contains(focused)) focused.focus({ preventScroll: true });
  else if (focusedAction === 'toggle-handled') list.querySelector<HTMLElement>('[data-act="toggle-handled"]')?.focus({ preventScroll: true });
  else if (focusedId) {
    let card = cards(list).find((el) => el.dataset.fid === focusedId);
    if (oldCards.get(focusedId)?.handled === false && !card?.classList.contains('is-open')) {
      const pending = cards(list.querySelector('.open-findings')!);
      const previousPending = [...oldCards].filter(([, old]) => !old.handled).map(([id]) => id);
      card = pending[Math.min(previousPending.indexOf(focusedId), pending.length - 1)] ?? card;
    }
    (card?.querySelector<HTMLElement>(`[data-act="${focusedAction}"]`) ?? card
      ?? list.querySelector<HTMLElement>('[data-act="toggle-handled"]'))?.focus({ preventScroll: true });
  }

  if (!motion) { for (const ghost of ghosts) ghost.remove(); return; }
  const positions = cards(list).map((card) => ({ card, rect: card.getBoundingClientRect(), opacity: getComputedStyle(card).opacity }));
  for (const { card, rect, opacity } of positions) {
    if (entering.has(card)) { enter(card, opacity); continue; }
    const old = oldCards.get(card.dataset.fid!);
    const dy = old?.rect ? old.rect.top - rect.top : 0;
    if (dy) card.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], MOTION);
  }
  for (const ghost of exits) {
    const animation = ghost.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(12px)' }], MOTION);
    const timeout = window.setTimeout(() => ghost.remove(), MOTION.duration + 100);
    const cleanup = () => { window.clearTimeout(timeout); ghost.remove(); };
    void animation.finished.then(cleanup, cleanup);
  }
}

function reconcile(parent: HTMLElement, next: HTMLElement, oldCards: Map<string, PreviousCard>) {
  const existing = [...parent.children] as HTMLElement[];
  const kept = new Set<HTMLElement>();
  let cursor = parent.firstElementChild;
  for (const desired of [...next.children] as HTMLElement[]) {
    const old = desired.dataset.fid ? oldCards.get(desired.dataset.fid)?.card
      : existing.find((el) => el.className === desired.className && !kept.has(el));
    let node = desired;
    if (old) {
      if (desired.dataset.fid) node = old;
      else if (['open-findings', 'handled-section', 'handled-findings'].includes(desired.className)) {
        old.hidden = desired.hidden;
        reconcile(old, desired, oldCards);
        node = old;
      } else if (old.outerHTML === desired.outerHTML) node = old;
    }
    kept.add(node);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextElementSibling;
  }
  for (const node of existing) if (!kept.has(node) && !node.classList.contains('is-exiting')) node.remove();
}

function enter(card: HTMLElement, opacity = getComputedStyle(card).opacity) {
  card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity, transform: 'translateY(0)' }], MOTION);
}
