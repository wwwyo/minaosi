import { browser } from '#imports';
import type { DraftBlock, Finding, MatchSite } from './types';
import type { SurfaceAdapter } from './surfaces/types';
import { blockText, captureSite, contextOf, indexOfRange, occurrences, applyReplacement, resolveSite } from './surfaces/resolve';
import { buildRequest, parseReport, type RawFinding } from './review/prompt';
import { LANGUAGE_RULES } from './rubric';
import { apiKeyItem, modelItem, consentedItem, ruleTogglesItem, styleGuideItem } from './store';
import { Decorations } from './ui/decorations';
import { renderPanel, wirePanel, type PanelState, type Filter } from './ui/panel';
import { PANEL_CSS } from './ui/styles';

interface ReviewMessage {
  type: 'minaosi:review';
  apiKey: string;
  body: unknown;
}

interface ReviewReply {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
}

export class Controller {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private panelRoot: HTMLElement;
  private fabRoot: HTMLElement;
  private deco: Decorations;
  private staleRaf = 0;

  private s: PanelState = {
    phase: 'idle',
    panelOpen: false,
    view: 'list',
    filter: 'open',
    selectedId: null,
    findings: [],
    apiKey: '',
    model: '',
    consented: false,
    ruleToggles: {},
    styleGuide: null,
  };

  constructor(
    private adapter: SurfaceAdapter,
    private editor: HTMLElement,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'minaosi-root';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.panelRoot = document.createElement('div');
    this.fabRoot = document.createElement('div');
    this.shadow.append(style, this.panelRoot, this.fabRoot);
    document.body.appendChild(this.host);

    this.deco = new Decorations(this.shadow, this.editor, {
      onSelect: (fid) => this.select(fid),
      onApplyMatch: (fid, idx) => this.applyMatch(fid, idx),
      onUnresolvable: (fid, idx, stale) => this.markStale(fid, idx, stale),
    });

    wirePanel(this.shadow as unknown as HTMLElement, () => this.s, {
      onRun: () => void this.run(),
      onTogglePanel: () => this.togglePanel(),
      onFilter: (f) => { this.s.filter = f; this.render(); },
      onSelect: (fid) => this.select(fid),
      onApplyFinding: (fid) => this.applyFinding(fid),
      onDelete: (fid) => { this.byId(fid)!.state = 'deleted'; this.s.selectedId = null; this.render(); },
      onRevert: (fid) => this.revert(fid),
      onOpenSettings: () => { this.s.view = 'settings'; this.render(); },
      onBackToList: () => { this.s.view = 'list'; this.render(); },
      onSaveKey: (k) => { this.s.apiKey = k; void apiKeyItem.setValue(k); },
      onClearKey: () => { this.s.apiKey = ''; void apiKeyItem.setValue(''); },
      onSaveModel: (m) => { this.s.model = m; void modelItem.setValue(m); },
      onToggleRule: (id, on) => { this.s.ruleToggles[id] = on; void ruleTogglesItem.setValue(this.s.ruleToggles); },
      onLoadStyleGuide: (name, content) => {
        this.s.styleGuide = { name, content };
        void styleGuideItem.setValue(this.s.styleGuide);
        this.render();
      },
      onClearStyleGuide: () => { this.s.styleGuide = null; void styleGuideItem.setValue(null); this.render(); },
      onConsentAndRun: () => {
        this.s.consented = true;
        void consentedItem.setValue(true);
        this.s.view = 'list';
        void this.run();
      },
      onRetry: () => void this.run(),
    });
  }

  async init() {
    const [apiKey, model, consented, rules, styleGuide] = await Promise.all([
      apiKeyItem.getValue(), modelItem.getValue(), consentedItem.getValue(),
      ruleTogglesItem.getValue(), styleGuideItem.getValue(),
    ]);
    this.s.apiKey = apiKey;
    this.s.model = model;
    this.s.consented = consented;
    this.s.ruleToggles = { ...rules };
    this.s.styleGuide = styleGuide;
    this.render();
  }

  setEditor(editor: HTMLElement) {
    this.editor = editor;
    this.deco.setEditor(editor);
  }

  private byId(fid: string) {
    return this.s.findings.find((f) => f.id === fid);
  }

  private render() {
    const { panel, fab } = renderPanel(this.s);
    this.panelRoot.innerHTML = panel;
    this.fabRoot.innerHTML = fab;
    this.deco.render(this.s.findings, this.s.selectedId);
  }

  private togglePanel() {
    this.s.panelOpen = !this.s.panelOpen;
    if (!this.s.panelOpen) this.s.view = 'list';
    this.render();
  }

  private select(fid: string | null) {
    const was = this.s.selectedId === fid;
    this.s.selectedId = was ? null : fid;
    this.render();
    if (!was && fid) {
      this.deco.flash(fid);
      this.panelRoot
        .querySelector('.n-item[data-sel]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** 再描画中に decorations が解決不能を報告してきたときに stale を立てる */
  private markStale(fid: string, idx: number, stale: boolean) {
    const m = this.byId(fid)?.matches[idx];
    if (!m || m.stale === stale) return;
    m.stale = stale;
    // render() → deco.render() → recompute は rAF 経由なので、ここで再 render するとループする。
    // パネル側の stale 表示だけ遅延で更新する。
    if (!this.staleRaf) {
      this.staleRaf = requestAnimationFrame(() => {
        this.staleRaf = 0;
        const { panel } = renderPanel(this.s);
        this.panelRoot.innerHTML = panel;
      });
    }
  }

  /* ---- 見直す ---- */

  async run() {
    if (this.s.phase === 'running') return;
    if (!this.s.apiKey) {
      this.s.panelOpen = true;
      this.s.view = 'settings';
      this.render();
      return;
    }
    if (!this.s.consented) {
      this.s.panelOpen = true;
      this.s.view = 'consent';
      this.render();
      return;
    }
    this.s.phase = 'running';
    this.s.panelOpen = true;
    this.s.view = 'list';
    this.s.error = undefined;
    this.render();
    try {
      const blocks = this.adapter.extractBlocks(this.editor);
      const body = buildRequest({
        model: this.s.model,
        blocks,
        enabledRules: LANGUAGE_RULES.filter((r) => this.s.ruleToggles[r.id] !== false),
        styleGuide: this.s.styleGuide?.content ?? null,
      });
      const msg: ReviewMessage = { type: 'minaosi:review', apiKey: this.s.apiKey, body };
      const reply = (await browser.runtime.sendMessage(msg)) as ReviewReply;
      if (!reply?.ok) {
        const detail = (reply?.data as { error?: { message?: string } } | undefined)?.error?.message;
        throw new Error(reply?.error ?? detail ?? `API エラー（status ${reply?.status ?? '?'}）`);
      }
      const parsed = parseReport(reply.data);
      if (!Array.isArray(parsed)) throw new Error(parsed.error);
      this.s.findings = this.normalize(parsed, blocks);
      this.s.phase = 'done';
      this.s.filter = 'open';
      this.s.selectedId = null;
    } catch (e) {
      this.s.phase = 'error';
      this.s.error = e instanceof Error ? e.message : String(e);
      this.s.findings = [];
    }
    this.render();
  }

  /** RawFinding → Finding。matches[].from を本文に照らし、出現位置と前後文脈を確定する */
  private normalize(raw: RawFinding[], blocks: DraftBlock[]): Finding[] {
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    const out: Finding[] = [];
    for (const [i, rf] of raw.entries()) {
      const block = typeof rf.block === 'number' ? byIndex.get(rf.block) : undefined;
      const matches: MatchSite[] = [];
      if (block) {
        const text = blockText(block.element);
        // from ごとの提供数がブロック内の出現数と一致するかで曖昧さを弾く
        const rawMatches = (rf.matches ?? []).filter((m): m is { from: string; to?: string } =>
          typeof m.from === 'string' && m.from.length > 0);
        const byFrom = new Map<string, number>();
        for (const m of rawMatches) byFrom.set(m.from, (byFrom.get(m.from) ?? 0) + 1);
        const seen = new Map<string, number>();
        for (const m of rawMatches) {
          const occ = occurrences(text, m.from);
          const provided = byFrom.get(m.from) ?? 0;
          const nth = seen.get(m.from) ?? 0;
          seen.set(m.from, nth + 1);
          // 出現数と提供数が一致しない限り、どの出現を指すか一意に決められない
          if (occ.length !== provided && !(occ.length === 1 && provided === 1)) continue;
          const cap = captureSite(block.element, m.from, nth);
          if (!cap) continue;
          matches.push({
            occurrence: nth, start: cap.start, from: m.from, to: m.to,
            before: cap.before, after: cap.after, applied: false, stale: false,
          });
        }
      }
      out.push({
        id: `f${i}`,
        kind: rf.kind as Finding['kind'],
        block: block ? block.index : -1,
        blockEl: block?.element,
        title: rf.title ?? '',
        reason: rf.reason ?? '',
        matches,
        source: rf.source?.url
          ? { url: rf.source.url, label: rf.source.label ?? rf.source.url, excerpt: rf.source.excerpt }
          : undefined,
        state: 'open',
      });
    }
    return out;
  }

  /* ---- 適用 / 元に戻す ---- */

  private applyMatch(fid: string, idx: number) {
    const f = this.byId(fid);
    const m = f?.matches[idx];
    if (!f || !m || !f.blockEl || m.applied || !m.to) return;
    const res = resolveSite(f.blockEl, m);
    if (res.status !== 'ok') {
      m.stale = true;
      this.render();
      return;
    }
    const startIdx = indexOfRange(f.blockEl, res.range);
    if (!applyReplacement(res.range, m.to)) {
      m.stale = true;
      this.render();
      return;
    }
    // undo 用に、適用後の to の前後文脈を採取する
    const text = blockText(f.blockEl);
    if (startIdx !== null && text.slice(startIdx, startIdx + m.to.length) === m.to) {
      const c = contextOf(text, startIdx, m.to.length);
      m.undoBefore = c.before;
      m.undoAfter = c.after;
    } else {
      // 挿入位置の直読みが合わない場合は from→to で置き換わった箇所を文脈で探す
      const hit = occurrences(text, m.to).find((i) => {
        const c = contextOf(text, i, (m.to as string).length);
        return c.after === m.after;
      });
      if (hit !== undefined) {
        const c = contextOf(text, hit, m.to.length);
        m.undoBefore = c.before;
        m.undoAfter = c.after;
      }
    }
    m.applied = true;
    m.stale = false;
    if (startIdx !== null) this.refreshAfterEdit(f.blockEl, startIdx, m.to.length - m.from.length, m);
    this.syncResolved(f);
    this.s.selectedId = null;
    this.render();
  }

  /**
   * 適用で本文がずれた分を、同じブロック内の未適用箇所の記録位置に反映する。
   * 文脈一致がまだ効く箇所はそのまま、ずれた箇所は位置ずれ後に from が一致すれば
   * 文脈を採り直す（自分の適用で隣の箇所が stale 化しないようにするため）。
   */
  private refreshAfterEdit(blockEl: HTMLElement, editStart: number, delta: number, justApplied: MatchSite) {
    const text = blockText(blockEl);
    for (const f of this.s.findings) {
      if (f.blockEl !== blockEl) continue;
      for (const m of f.matches) {
        if (m === justApplied || m.applied) continue;
        if (resolveSite(blockEl, m).status === 'ok') continue;
        const shifted = m.start > editStart ? m.start + delta : m.start;
        if (text.slice(shifted, shifted + m.from.length) !== m.from) {
          m.stale = true;
          continue;
        }
        m.start = shifted;
        const c = contextOf(text, shifted, m.from.length);
        m.before = c.before;
        m.after = c.after;
        m.occurrence = occurrences(text, m.from).indexOf(shifted);
      }
    }
  }

  /** カードの「適用」はその指摘の未適用の全箇所を適用する */
  private applyFinding(fid: string) {
    const f = this.byId(fid);
    if (!f) return;
    for (const [i, m] of f.matches.entries()) {
      if (!m.applied && m.to !== undefined && !m.stale) this.applyMatch(fid, i);
    }
  }

  private syncResolved(f: Finding) {
    const allApplied = f.matches.length > 0 && f.matches.every((m) => m.applied);
    f.state = allApplied ? 'resolved' : 'open';
  }

  /** 適用済み → 各箇所を原文へ戻す（それぞれ1編集操作）。削除 → 未対応へ復元 */
  private revert(fid: string) {
    const f = this.byId(fid);
    if (!f) return;
    if (f.state === 'deleted') {
      f.state = 'open';
      this.s.selectedId = null;
      this.render();
      return;
    }
    for (const m of f.matches) {
      if (!m.applied || !m.to || !f.blockEl) continue;
      const res = resolveSite(f.blockEl, {
        from: m.to,
        before: m.undoBefore ?? '',
        after: m.undoAfter ?? '',
      });
      const at = res.status === 'ok' ? indexOfRange(f.blockEl, res.range) : null;
      if (res.status !== 'ok' || !applyReplacement(res.range, m.from)) {
        m.stale = true;
        continue;
      }
      m.applied = false;
      m.stale = false;
      m.undoBefore = m.undoAfter = undefined;
      if (at !== null) {
        // revert で to→from に戻した分も同ブロック内の他箇所の位置に反映する
        const text = blockText(f.blockEl);
        if (text.slice(at, at + m.from.length) === m.from) {
          m.start = at;
          const c = contextOf(text, at, m.from.length);
          m.before = c.before;
          m.after = c.after;
          m.occurrence = occurrences(text, m.from).indexOf(at);
        }
        this.refreshAfterEdit(f.blockEl, at, m.from.length - m.to.length, m);
      }
    }
    this.syncResolved(f);
    this.s.selectedId = null;
    this.render();
  }

  dispose() {
    this.deco.dispose();
    this.host.remove();
  }
}
