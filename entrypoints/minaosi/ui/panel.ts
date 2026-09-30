import { KIND_LABEL, type Finding, type FindingState } from '../types';
import {
  LOGO_MARK, ICON_APPLY, ICON_TRASH, ICON_UNDO,
  ICON_SPARKLES,
} from './icons';

export type View = 'list';

export type PanelFinding = Omit<Finding, 'blockEl'>;

export interface PanelState {
  phase: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  view: View;
  filter: FindingState;
  selectedId: string | null;
  findings: PanelFinding[];
  connectionLoading: boolean;
}

export interface PanelHandlers {
  onRun(): void;
  onFilter(f: FindingState): void;
  onSelect(fid: string | null): void;
  onApplyFinding(fid: string): void;
  onDelete(fid: string): void;
  onRevert(fid: string): void;
  onRetry(): void;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TABS: [FindingState, string][] = [['open', '未対応'], ['resolved', '適用済み'], ['deleted', '削除']];

function counts(findings: PanelFinding[]): Record<FindingState, number> {
  const c: Record<FindingState, number> = { open: 0, resolved: 0, deleted: 0 };
  for (const f of findings) c[f.state]++;
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
  return `<div class="n-item is-${f.state}" data-fid="${f.id}" tabindex="0" role="button"${f.id === selectedId ? ' data-sel' : ''}>
    <div class="meta"><span class="kind">${KIND_LABEL[f.kind]}</span></div>
    <div class="ttl">${esc(f.title)}</div>
    <div class="detail">
      <div class="rsn">${esc(f.reason)}</div>
      ${f.source ? `<div class="src">出典: <a href="${esc(f.source.url)}" target="_blank" rel="noopener noreferrer">${esc(f.source.label || f.source.url)}</a>${f.source.excerpt ? `<span class="loc"> — ${esc(f.source.excerpt)}</span>` : ''}</div>` : ''}
      ${stale ? '<div class="stale">対象箇所が編集され、修正案と一致しなくなりました。もう一度「見直す」で確認してください。</div>' : ''}
    </div>
    ${actsHTML(f)}
  </div>`;
}

function isEmptyState(s: PanelState): boolean {
  return (s.phase === 'idle' || s.phase === 'done') && s.findings.length === 0;
}

function listBody(s: PanelState): string {
  if (s.phase === 'error') {
    return `<div class="notice">見直しが完了しませんでした。<br>${esc(s.error ?? '不明なエラー')}
      <div class="actions"><button class="run-btn sm" data-act="retry">再試行</button></div></div>`;
  }
  if (isEmptyState(s)) {
    return `<div class="empty-start">${s.phase === 'done' ? '<span>指摘はありません</span>' : ''}<button class="run-btn" data-act="run"${s.connectionLoading ? ' disabled' : ''}><span class="pre">${ICON_SPARKLES}</span>${s.connectionLoading ? '読込中…' : '見直す'}</button></div>`;
  }
  if (s.phase === 'running' && s.findings.length === 0) return '<div class="empty">原稿を見直しています…</div>';
  const list = s.findings.filter((f) => f.state === s.filter);
  return list.map((f) => cardHTML(f, s.selectedId)).join('') || '<div class="empty">指摘はありません</div>';
}

export function renderFab(): string {
  return `<button class="mn fab" title="指摘paneを開く" aria-label="指摘paneを開く">${LOGO_MARK}</button>`;
}

export function renderPanel(s: PanelState): string {
  const c = counts(s.findings);
  const prog = TABS.filter(([k]) => c[k] > 0)
    .map(([k, label]) => `${label} ${c[k]}`)
    .join(' · ');

  const empty = isEmptyState(s);
  const tabs = `<div class="filters">${TABS.map(
    ([k, l]) => `<button data-act="filter" data-f="${k}" class="${s.filter === k ? 'on' : ''}" aria-pressed="${s.filter === k}">${l}</button>`,
  ).join('')}</div>`;

  return `<aside class="mn panel" aria-label="minaosi 指摘一覧">
    <header><div class="head-row">${tabs}
      ${empty ? '' : `<button class="run-btn sm" data-act="run" ${s.phase === 'running' || s.connectionLoading ? 'disabled' : ''}>${s.connectionLoading ? '読込中…' : s.phase === 'running' ? '見直し中…' : `<span class="pre">${ICON_SPARKLES}</span>見直す`}</button>`}
    </div>${prog ? `<div class="prog">${prog}</div>` : ''}</header>
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
        case 'retry': h.onRetry(); return;
        case 'filter': h.onFilter(actEl.dataset.f as FindingState); return;
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
