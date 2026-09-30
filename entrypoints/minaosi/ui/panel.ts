import { KIND_LABEL, type Finding, type FindingState } from '../types';
import { LANGUAGE_RULES } from '../rubric';
import { PROVIDER_LABELS } from '../store';
import type { ReviewProvider } from '../review/providers';
import {
  LOGO_MARK, ICON_APPLY, ICON_TRASH, ICON_UNDO,
  ICON_SPARKLES, ICON_SETTINGS,
} from './icons';

export type View = 'list' | 'settings' | 'consent';

export type PanelFinding = Omit<Finding, 'blockEl'>;

export interface PanelState {
  phase: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  view: View;
  filter: FindingState;
  selectedId: string | null;
  findings: PanelFinding[];
  provider: ReviewProvider;
  connectionLoading: boolean;
  apiKey: string;
  model: string;
  consented: boolean;
}

export interface PanelHandlers {
  onRun(): void;
  onFilter(f: FindingState): void;
  onSelect(fid: string | null): void;
  onApplyFinding(fid: string): void;
  onDelete(fid: string): void;
  onRevert(fid: string): void;
  onOpenSettings(): void;
  onBackToList(): void;
  onSaveKey(key: string): void;
  onClearKey(): void;
  onSaveModel(model: string): void;
  onSaveProvider(provider: ReviewProvider): void;
  onConsentAndRun(): void;
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

function listBody(s: PanelState): string {
  if (s.phase === 'error') {
    return `<div class="notice">見直しが完了しませんでした。<br>${esc(s.error ?? '不明なエラー')}
      <div class="actions"><button class="run-btn sm" data-act="retry">再試行</button>
      <button class="btn-ghost" data-act="settings">設定</button></div></div>`;
  }
  if (s.phase === 'idle' && s.findings.length === 0) {
    return '<div class="empty">「見直す」で AI の校閲を開始します</div>';
  }
  const list = s.findings.filter((f) => f.state === s.filter);
  return list.map((f) => cardHTML(f, s.selectedId)).join('') || '<div class="empty">指摘はありません</div>';
}

function settingsBody(s: PanelState): string {
  return `<div class="subview">
    <div class="fld">
      <label>送信先</label>
      <select data-set="provider" aria-label="送信先"${s.phase === 'running' || s.connectionLoading ? ' disabled' : ''}>
        <option value="anthropic"${s.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
        <option value="openai"${s.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
      </select>
      <div class="provider">${PROVIDER_LABELS[s.provider]} に原稿全文と校閲ルールを送信します。通信料・API 料金は API key の持ち主（あなた）の負担です。</div>
    </div>
    <div class="fld">
      <label>API key</label>
      <input type="password" data-set="apiKey" value="${esc(s.apiKey)}" autocomplete="off"${s.connectionLoading ? ' disabled' : ''}>
      <div class="help">この拡張のローカル領域にのみ保存します</div>
    </div>
    <div class="fld">
      <label>モデル</label>
      <input type="text" data-set="model" value="${esc(s.model)}"${s.connectionLoading ? ' disabled' : ''}>
      ${s.provider === 'openai' ? '<div class="help">Responses APIのweb searchに対応したモデルを指定します</div>' : ''}
    </div>
    <div class="fld">
      <label>日本語ルール（常時適用）</label>
      ${LANGUAGE_RULES.map(
        (r) => `<div class="rule"><span><span class="nm">${esc(r.label)}</span> <span class="hint">${esc(r.hint)}</span></span></div>`,
      ).join('')}
    </div>
    <div class="fld">
      <label>送信への同意</label>
      <div class="provider">${s.consented ? '同意済み' : '未同意 — 初回の「見直す」前に同意が必要です'}</div>
    </div>
    <div class="set-actions">
      <button class="run-btn sm" data-act="back">戻る</button>
    </div>
  </div>`;
}

function consentBody(s: PanelState): string {
  return `<div class="subview">
    <h4>原稿の外部送信について</h4>
    <p class="desc">「見直す」を実行すると、エディタの原稿全文と校閲ルールが ${PROVIDER_LABELS[s.provider]} の API に送信されます。送信にはあなた自身の API key を使い、費用はあなたの負担です。</p>
    <div class="set-actions">
      <button class="run-btn" data-act="consent">同意して実行</button>
      <button class="btn-ghost" data-act="back">戻る</button>
    </div>
  </div>`;
}

export function renderFab(): string {
  return `<button class="mn fab" title="指摘paneを開く" aria-label="指摘paneを開く">${LOGO_MARK}</button>`;
}

export function renderPanel(s: PanelState): string {
  const c = counts(s.findings);
  const prog = TABS.filter(([k]) => c[k] > 0)
    .map(([k, label]) => `${label} ${c[k]}`)
    .join(' · ');

  let body: string;
  if (s.view === 'settings') body = settingsBody(s);
  else if (s.view === 'consent') body = consentBody(s);
  else body = `<div class="list">${listBody(s)}</div>`;

  const tabs =
    s.view === 'list'
      ? `<div class="filters">${TABS.map(
          ([k, l]) => `<button data-act="filter" data-f="${k}" class="${s.filter === k ? 'on' : ''}" aria-pressed="${s.filter === k}">${l}</button>`,
        ).join('')}</div>`
      : '';

  return `<aside class="mn panel" aria-label="minaosi 指摘一覧">
    <header><div class="head-row">
      <div class="brand">${LOGO_MARK}<span class="brand-name">minaosi</span></div>
      <span class="sp">
        <button class="icon-btn" data-act="settings" title="設定" aria-label="設定">${ICON_SETTINGS}</button>
        <button class="run-btn sm" data-act="run" ${s.phase === 'running' || s.connectionLoading ? 'disabled' : ''}>${s.connectionLoading ? '読込中…' : s.phase === 'running' ? '見直し中…' : `<span class="pre">${ICON_SPARKLES}</span>見直す`}</button>
      </span>
    </div>
    ${s.view === 'list' ? `<div class="prog">${prog}</div>` : ''}${tabs}</header>
    ${body}
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
        case 'settings': h.onOpenSettings(); return;
        case 'back': h.onBackToList(); return;
        case 'consent': h.onConsentAndRun(); return;
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

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.set === 'apiKey') h.onSaveKey(t.value.trim());
    if (t.dataset.set === 'model') h.onSaveModel(t.value.trim());
    if (t.dataset.set === 'provider' && (t.value === 'anthropic' || t.value === 'openai')) h.onSaveProvider(t.value);
  });
}
