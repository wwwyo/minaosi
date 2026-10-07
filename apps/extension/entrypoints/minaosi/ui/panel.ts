import { KIND_LABEL, type Finding } from '../types';
import type { FactCheckSummary } from '@minaosi/api/rpc';
import type { EditorStatus } from '../surfaces/types';
import {
  LOGO_MARK, ICON_APPLY, ICON_TRASH, ICON_UNDO,
  ICON_SPARKLES, ICON_EYE, ICON_EYE_OFF,
} from './icons';

export type View = 'list';

export type PanelFinding = Omit<Finding, 'blockEl'>;

export interface PanelState {
  editorStatus: EditorStatus;
  canReview: boolean;
  editorId: string | null;
  phase: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  factCheck?: FactCheckSummary;
  view: View;
  selectedId: string | null;
  findings: PanelFinding[];
  connectionLoading: boolean;
}

export type ReviewState = Omit<PanelState, 'editorStatus' | 'canReview' | 'editorId'>;

export interface PanelHandlers {
  onRun(): void;
  onToggleHandled(): void;
  onSelect(fid: string | null): void;
  onApplyFinding(fid: string): void;
  onDelete(fid: string): void;
  onRevert(fid: string): void;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  return `<div class="n-item is-${f.state}" data-fid="${esc(f.id)}" tabindex="0" role="button" aria-expanded="${f.id === selectedId}"${f.id === selectedId ? ' data-sel' : ''}>
    <div class="meta"><span class="kind">${KIND_LABEL[f.kind]}</span>${status}</div>
    <div class="ttl">${esc(f.title)}</div>
    <div class="detail"${f.id === selectedId ? '' : ' inert'}><div class="detail-body">
      <div class="rsn">${esc(f.reason)}</div>
      ${f.source ? `<div class="src">出典: <a href="${esc(f.source.url)}" target="_blank" rel="noopener noreferrer">${esc(f.source.label || f.source.url)}</a>${f.source.excerpt ? `<span class="loc"> — ${esc(f.source.excerpt)}</span>` : ''}</div>` : ''}
      ${stale ? '<div class="stale">対象箇所が編集され、修正案と一致しなくなりました。</div>' : ''}
    </div></div>
    ${actsHTML(f)}
  </div>`;
}

function isEmptyState(s: PanelState): boolean {
  return s.phase === 'idle' && s.findings.length === 0;
}

function listBody(s: PanelState, showHandled: boolean): string {
  if (s.editorStatus === 'none') return '<div class="empty">編集領域はありません</div>';
  if (s.phase === 'error') {
    return `<div class="notice">見直しが完了しませんでした。<br>${esc(s.error ?? '不明なエラー')}</div>`;
  }
  if (isEmptyState(s)) {
    const hint = s.editorStatus === 'unknown'
      ? `<div class="empty">${s.canReview ? '本文かは未判定です。選んだ編集領域を見直せます。' : '本文かは未判定です。見直したい編集領域をクリックしてください。'}</div>` : '';
    return `<div class="empty-start">${hint}<button class="run-btn" data-act="run"${s.connectionLoading || !s.canReview ? ' disabled' : ''}><span class="pre">${ICON_SPARKLES}</span>${s.connectionLoading ? '読込中…' : '見直す'}</button></div>`;
  }
  if (s.phase === 'running' && s.findings.length === 0) return '<div class="empty">原稿を見直しています…</div>';
  const open = s.findings.filter((f) => f.state === 'open');
  const handled = s.findings.filter((f) => f.state !== 'open');
  if (showHandled) handled.sort((a, b) => (a.handledOrder ?? 0) - (b.handledOrder ?? 0));
  const toggleLabel = showHandled ? '対応済みを隠す' : '対応済みを表示する';
  return `<div class="open-findings">${open.map((f) => cardHTML(f, s.selectedId)).join('') || '<div class="empty">指摘はありません</div>'}</div>
    ${handled.length ? `<section class="handled-section" aria-label="対応済み">
      <div class="handled-heading"><span>対応済み</span><button data-act="toggle-handled" title="${toggleLabel}" aria-label="${toggleLabel}" aria-expanded="${showHandled}" aria-controls="handled-findings">${showHandled ? ICON_EYE : ICON_EYE_OFF}</button></div>
      <div id="handled-findings" class="handled-findings"${showHandled ? '' : ' hidden'}>${showHandled ? handled.map((f) => cardHTML(f, s.selectedId)).join('') : ''}</div>
    </section>` : ''}`;
}

export function renderFab(): string {
  return `<button class="mn fab" title="指摘paneを開閉する" aria-label="指摘paneを開閉する">${LOGO_MARK}</button>`;
}

export function renderPanel(s: PanelState, showHandled = false): string {
  const factCheck = s.phase === 'done' && s.factCheck?.status === 'partial'
    ? `<div class="notice" role="status">事実確認は原稿全体を網羅していません。参照先を取得した段落：${s.factCheck.sourceCheckedBlocks.map(block => block + 1).join('、')}。出典付きの指摘以外の主張は未確認です。</div>`
    : '';

  return `<aside class="mn panel" aria-label="minaosi 指摘一覧">
    <div class="list">${factCheck}${listBody(s, showHandled)}</div>
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
        case 'toggle-handled': h.onToggleHandled(); return;
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
