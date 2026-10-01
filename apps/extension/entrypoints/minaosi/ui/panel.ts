import { KIND_LABEL, type Finding } from '../types';
import {
  LOGO_MARK, ICON_APPLY, ICON_TRASH, ICON_UNDO,
  ICON_SPARKLES,
} from './icons';

export type View = 'list';
export type PanelFilter = 'open' | 'handled';

export type PanelFinding = Omit<Finding, 'blockEl'>;

export interface PanelState {
  phase: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  view: View;
  filter: PanelFilter;
  selectedId: string | null;
  findings: PanelFinding[];
  connectionLoading: boolean;
}

export interface PanelHandlers {
  onRun(): void;
  onFilter(f: PanelFilter): void;
  onSelect(fid: string | null): void;
  onApplyFinding(fid: string): void;
  onDelete(fid: string): void;
  onRevert(fid: string): void;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TABS: [PanelFilter, string][] = [['open', '未対応'], ['handled', '対応済み']];

function counts(findings: PanelFinding[]): Record<PanelFilter, number> {
  const c: Record<PanelFilter, number> = { open: 0, handled: 0 };
  for (const f of findings) c[f.state === 'open' ? 'open' : 'handled']++;
  return c;
}

function actsHTML(f: PanelFinding): string {
  if (f.state === 'resolved' || f.state === 'deleted') {
    const label = f.state === 'resolved' ? '適用を元に戻す' : '復元';
    return `<div class="acts"><button data-act="revert" title="${label}" aria-label="${label}">${ICON_UNDO}</button></div>`;
  }
  const applyable = f.matches.some((m) => m.to !== undefined && !m.applied && !m.stale);
  const apply = applyable
    ? `<button class="primary" data-act="apply" title="適用" aria-label="適用">${ICON_APPLY}</button>` : '';
  return `<div class="acts">${apply}<button class="trash" data-act="delete" title="削除" aria-label="削除">${ICON_TRASH}</button></div>`;
}

function cardHTML(f: PanelFinding, selectedId: string | null): string {
  const stale = f.state === 'open' && f.matches.length > 0 && f.matches.every((m) => m.stale || m.applied);
  const status = f.state === 'open' ? '' : `<span class="status">${f.state === 'resolved' ? '適用済み' : '削除'}</span>`;
  return `<div class="n-item is-${f.state}" data-fid="${f.id}" tabindex="0" role="button"${f.id === selectedId ? ' data-sel' : ''}>
    <div class="meta"><span class="kind">${KIND_LABEL[f.kind]}</span>${status}</div>
    <div class="ttl">${esc(f.title)}</div>
    <div class="detail">
      <div class="rsn">${esc(f.reason)}</div>
      ${f.source ? `<div class="src">出典: <a href="${esc(f.source.url)}" target="_blank" rel="noopener noreferrer">${esc(f.source.label || f.source.url)}</a>${f.source.excerpt ? `<span class="loc"> — ${esc(f.source.excerpt)}</span>` : ''}</div>` : ''}
      ${stale ? '<div class="stale">対象箇所が編集され、修正案と一致しなくなりました。</div>' : ''}
    </div>
    ${actsHTML(f)}
  </div>`;
}

function isEmptyState(s: PanelState): boolean {
  return s.phase === 'idle' && s.findings.length === 0;
}

function listBody(s: PanelState): string {
  if (s.phase === 'error') {
    return `<div class="notice">見直しが完了しませんでした。<br>${esc(s.error ?? '不明なエラー')}</div>`;
  }
  if (isEmptyState(s)) {
    return `<div class="empty-start"><button class="run-btn" data-act="run"${s.connectionLoading ? ' disabled' : ''}><span class="pre">${ICON_SPARKLES}</span>${s.connectionLoading ? '読込中…' : '見直す'}</button></div>`;
  }
  if (s.phase === 'running' && s.findings.length === 0) return '<div class="empty">原稿を見直しています…</div>';
  const list = s.findings.filter((f) => s.filter === 'open' ? f.state === 'open' : f.state !== 'open');
  return list.map((f) => cardHTML(f, s.selectedId)).join('') || '<div class="empty">指摘はありません</div>';
}

export function renderFab(): string {
  return `<button class="mn fab" title="指摘paneを開閉する" aria-label="指摘paneを開閉する">${LOGO_MARK}</button>`;
}

export function renderPanel(s: PanelState): string {
  const c = counts(s.findings);
  const prog = TABS.filter(([k]) => c[k] > 0)
    .map(([k, label]) => `${label} ${c[k]}`)
    .join(' · ');

  const tabs = `<div class="filters">${TABS.map(
    ([k, l]) => `<button data-act="filter" data-f="${k}" class="${s.filter === k ? 'on' : ''}" aria-pressed="${s.filter === k}">${l}</button>`,
  ).join('')}</div>`;

  return `<aside class="mn panel" aria-label="minaosi 指摘一覧">
    <header><div class="head-row">${tabs}</div>${prog ? `<div class="prog">${prog}</div>` : ''}</header>
    <div class="list">${listBody(s)}</div>
  </aside>`;
}

export function wirePanel(
  root: HTMLElement,
  h: PanelHandlers,
) {
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const actEl = t.closest('[data-act]') as HTMLElement | null;
    const card = t.closest('.n-item') as HTMLElement | null;
    const fid = card?.dataset.fid;

    if (actEl) {
      switch (actEl.dataset.act) {
        case 'run': h.onRun(); return;
        case 'filter': {
          const filter = actEl.dataset.f;
          if (filter === 'open' || filter === 'handled') h.onFilter(filter);
          return;
        }
        case 'apply': if (fid) h.onApplyFinding(fid); return;
        case 'delete': if (fid) h.onDelete(fid); return;
        case 'revert': if (fid) h.onRevert(fid); return;
      }
    }
    if (t.closest('a')) return;
    // 選択トグルは controller 側で行う（decorations の onSelect 経路と同じ）
    if (card) h.onSelect(card.dataset.fid ?? null);
  });

  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (!t.classList?.contains('n-item')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      h.onSelect(t.dataset.fid ?? null);
    }
  });

}
