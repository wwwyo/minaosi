import { browser } from '#imports';
import type { DraftBlock, Finding, MatchSite } from './types';
import { selectReviewEditor, type ReviewTrigger, type SurfaceAdapter } from './surfaces/types';
import { blockText, captureInText, contextOf, indexOfRange, occurrences, applyReplacement, rangeAt, resolveSite, seamIndex, undoSite, minimalReplacement } from './surfaces/resolve';
import type { ReviewedFinding, FactCheckSummary } from '@minaosi/api/rpc';
import { isReviewProvider, type ReviewMode, type ReviewProvider, type ReviewRequest } from './review/providers';
import { Decorations } from './ui/decorations';
import { renderFab, type ReviewState } from './ui/panel';
import { PANEL_CSS } from './ui/styles';
import type { PanelCommand, TurnstileProof } from './panel-messages';
import { PanelToggle } from './panel-toggle';

interface ReviewReply {
  ok: boolean;
  error?: string;
  findings?: ReviewedFinding[];
  factCheck?: FactCheckSummary;
}

export class Controller {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private fabRoot: HTMLElement;
  private deco: Decorations;
  private staleRaf = 0;
  private handledSequence = 0;
  private reviewSequence = 0;
  private providerLoad = 0;
  private disposed = false;
  private stopConfigWatch: (() => void) | null = null;
  private stopPanelWatch: (() => void) | null = null;
  // 認証情報の実値は持たない。キーの有無だけを background に問い合わせる（ADR 0004）。
  private config = { mode: 'default' as ReviewMode, provider: 'anthropic' as ReviewProvider, model: '', hasKey: false };
  /** background から設定を一度でも取得できたか。未取得のまま実行させない。 */
  private configLoaded = false;

  private s: Omit<ReviewState, 'findings'> & { findings: Finding[] } = {
    phase: 'idle',
    view: 'list',
    selectedId: null,
    findings: [],
    connectionLoading: true,
  };

  constructor(
    private adapter: SurfaceAdapter,
    private editor: HTMLElement,
    private publish: () => void,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'minaosi-root';
    // ページ側の script に本文マークの内部 DOM を公開しない
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.fabRoot = document.createElement('div');
    this.shadow.append(style, this.fabRoot);
    document.body.appendChild(this.host);

    this.deco = new Decorations(this.shadow, this.editor, {
      onSelect: (fid) => this.select(fid),
      onApplyMatch: (fid, idx) => this.applyMatch(fid, idx),
      onUnresolvable: (fid, idx, stale) => this.markStale(fid, idx, stale),
      onUnapplied: (fid, idx) => this.markUnapplied(fid, idx),
    });

    this.fabRoot.innerHTML = renderFab();
    const fab = this.fabRoot.querySelector('button')!;
    const toggle = new PanelToggle((open, busy) => {
      fab.disabled = open === null || busy;
      if (import.meta.env.BROWSER !== 'firefox') fab.setAttribute('aria-expanded', String(open === true));
    });
    if (import.meta.env.BROWSER === 'firefox') {
      toggle.receive(false);
    } else {
      fab.disabled = true;
      const onState: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
        if (sender.id === browser.runtime.id && message?.type === 'minaosi:panel-state' && typeof message.open === 'boolean') toggle.receive(message.open);
      };
      browser.runtime.onMessage.addListener(onState);
      this.stopPanelWatch = () => browser.runtime.onMessage.removeListener(onState);
      void toggle.initialize(async () => {
        const state = await browser.runtime.sendMessage({ type: 'minaosi:get-panel-state' });
        if (typeof state?.open !== 'boolean') throw new Error('paneの状態を取得できません');
        return state.open;
      }).catch(() => {});
    }
    fab.addEventListener('click', () => {
      void toggle.toggle(async (open) => {
        const reply = await browser.runtime.sendMessage({ type: 'minaosi:toggle-panel', open });
        if (!reply?.ok) throw new Error(reply?.error ?? 'paneを開閉できません');
      }).catch(() => {});
    });
  }

  handleCommand(command: PanelCommand) {
    if (this.disposed) return;
    switch (command.action) {
      case 'run': void this.run(command.trigger, command.turnstile); return;
      case 'select': this.select(command.id); return;
      case 'apply': this.applyFinding(command.id); return;
      case 'delete': {
        const f = this.byId(command.id);
        if (!f) return;
        this.setFindingState(f, 'deleted');
        this.s.selectedId = null;
        break;
      }
      case 'revert': this.revert(command.id); return;
    }
    this.render();
  }

  snapshot(): ReviewState {
    return { ...this.s, findings: this.s.findings.map(({ blockEl, ...finding }) => finding) };
  }

  async init() {
    if (this.disposed) return;
    // content script から storage.local を直接読まない。設定変更は background が中継する。
    const onConfig: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message, sender) => {
      if (sender?.id !== browser.runtime.id) return;
      if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'minaosi:review-config-changed') {
        void this.reloadConfig();
      }
    };
    browser.runtime.onMessage.addListener(onConfig);
    this.stopConfigWatch = () => browser.runtime.onMessage.removeListener(onConfig);
    await this.reloadConfig();
  }

  private async reloadConfig() {
    const generation = ++this.providerLoad;
    this.s.connectionLoading = true;
    this.render();
    try {
      const reply = (await browser.runtime.sendMessage({ type: 'minaosi:get-review-config' })) as {
        ok?: unknown; mode?: unknown; provider?: unknown; model?: unknown; hasKey?: unknown;
      } | undefined;
      if (this.disposed || generation !== this.providerLoad) return;
      if (reply?.ok === true && isReviewProvider(reply.provider)) {
        this.config = {
          mode: reply.mode === 'byok' ? 'byok' : 'default',
          provider: reply.provider,
          model: typeof reply.model === 'string' ? reply.model : '',
          hasKey: reply.hasKey === true,
        };
        this.configLoaded = true;
      }
    } catch {
      // background 未起動時は前回値を維持する。
    }
    if (this.disposed || generation !== this.providerLoad) return;
    this.s.connectionLoading = false;
    this.render();
  }

  private byId(fid: string) {
    return this.s.findings.find((f) => f.id === fid);
  }

  private render() {
    if (this.disposed) return;
    this.publish();
    this.deco.render(this.s.findings, this.s.selectedId);
  }

  private select(fid: string | null) {
    const was = this.s.selectedId === fid;
    this.s.selectedId = was ? null : fid;
    this.render();
    if (!was && fid) {
      this.deco.flash(fid);
    }
  }

  /** decorations の再計算中に来る状態変化は rAF で1回にまとめて render する（直列化してループを防ぐ） */
  private queueRender() {
    if (this.staleRaf) return;
    this.staleRaf = requestAnimationFrame(() => {
      this.staleRaf = 0;
      this.render();
    });
  }

  /** 再描画中に decorations が解決不能を報告してきたときに stale を立てる */
  private markStale(fid: string, idx: number, stale: boolean) {
    const m = this.byId(fid)?.matches[idx];
    if (!m || m.stale === stale) return;
    m.stale = stale;
    this.queueRender();
  }

  /** エディタ側の undo 等で適用済み箇所が原文に戻ったとき、適用状態を解除する */
  private markUnapplied(fid: string, idx: number) {
    const f = this.byId(fid);
    const m = f?.matches[idx];
    if (!f || !m?.applied) return;
    m.applied = false;
    m.undoBefore = m.undoAfter = undefined;
    this.syncResolved(f);
    this.queueRender();
  }

  private isCurrentEditor(): boolean {
    return this.canRun('manual');
  }

  private canRun(trigger: ReviewTrigger): boolean {
    return selectReviewEditor(this.adapter.detectEditor(document), trigger) === this.editor;
  }

  /* ---- 見直す ---- */

  async run(trigger: ReviewTrigger, turnstile?: TurnstileProof) {
    if (this.disposed || this.s.phase === 'running' || this.s.connectionLoading) return;
    // 初期値を読み込み済みと扱わない。未取得なら再取得し、それでも駄目なら実行しない。
    if (!this.configLoaded) await this.reloadConfig();
    if (this.disposed) return;
    if (!this.configLoaded) {
      this.s.phase = 'error';
      this.s.error = '設定を読み込めませんでした。ページを開き直してください';
      this.render();
      return;
    }
    if (!this.canRun(trigger)) return;
    if (turnstile?.error) {
      this.s.phase = 'error';
      this.s.error = turnstile.error;
      this.render();
      return;
    }
    if (this.config.mode === 'byok' && (!this.config.hasKey || !this.config.model)) {
      this.s.phase = 'error';
      this.s.error = '拡張機能のオプションでAPIキーとモデルを登録してください';
      this.render();
      return;
    }
    this.s.phase = 'running';
    this.s.view = 'list';
    this.s.error = undefined;
    this.s.factCheck = undefined;
    this.render();
    try {
      const blocks = this.adapter.extractBlocks(this.editor);
      const draft = blocks.map(({ index, text }) => ({ index, text }));
      const msg: ReviewRequest = this.config.mode === 'default'
        ? { type: 'minaosi:review', mode: 'default', blocks: draft }
        : { type: 'minaosi:review', mode: 'byok', provider: this.config.provider, model: this.config.model, blocks: draft };
      msg.turnstileToken = turnstile?.token;
      const reply = (await browser.runtime.sendMessage(msg)) as ReviewReply;
      if (this.disposed) return;
      if (!this.canRun(trigger)) { this.s.phase = 'idle'; this.render(); return; }
      if (!reply?.ok || !Array.isArray(reply.findings)) {
        throw new Error(reply?.error ?? '校閲結果が返りませんでした');
      }
      this.s.findings = this.normalize(reply.findings, blocks);
      this.s.factCheck = reply.factCheck;
      this.s.phase = 'done';
      this.s.selectedId = null;
    } catch (e) {
      this.s.phase = 'error';
      this.s.error = e instanceof Error ? e.message : String(e);
      // 既存の指摘・適用状態は残す（通信失敗の再実行で消えない）
    }
    this.render();
  }

  /**
   * RawFinding → Finding。matches[].from を本文に照らし、出現位置と前後文脈を確定する。
   * 文脈は送信時のスナップショット（block.text）から採る — 応答を待つ間にユーザーが
   * 本文を編集していても、現在の本文との再解決は resolveSite の文脈一致が担う
   */
  private normalize(raw: ReviewedFinding[], blocks: DraftBlock[]): Finding[] {
    const byIndex = new Map(blocks.map((b) => [b.index, b]));
    const out: Finding[] = [];
    const review = ++this.reviewSequence;
    for (const [i, rf] of raw.entries()) {
      const block = typeof rf.block === 'number' ? byIndex.get(rf.block) : undefined;
      const matches: MatchSite[] = [];
      if (block) {
        const text = block.text;
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
          if (occ.length !== provided) continue;
          const cap = captureInText(text, m.from, nth);
          if (!cap) continue;
          const replacement = m.to === undefined ? { from: m.from, to: undefined, offset: 0 } : minimalReplacement(m.from, m.to);
          if (!replacement) continue;
          const start = cap.start + replacement.offset;
          matches.push({
            occurrence: occurrences(text, replacement.from).indexOf(start), start,
            from: replacement.from, to: replacement.to,
            ...contextOf(text, start, replacement.from.length), applied: false, stale: false,
          });
        }
      }
      out.push({
        id: `r${review}-f${i}`,
        kind: rf.kind,
        block: block ? block.index : -1,
        blockEl: block?.element,
        title: rf.title ?? '',
        reason: rf.reason ?? '',
        matches,
        // リンク先は http(s) のみ。モデル出力の javascript: 等のスキームは href に載せない
        source: rf.source?.url && /^https?:\/\//i.test(rf.source.url)
          ? { url: rf.source.url, label: rf.source.label ?? rf.source.url, excerpt: rf.source.excerpt }
          : undefined,
        state: 'open',
      });
    }
    return out;
  }

  /* ---- 適用 / 元に戻す ---- */

  private applyMatch(fid: string, idx: number) {
    this.applyMatchCore(fid, idx);
    this.render();
  }

  private applyMatchCore(fid: string, idx: number) {
    if (this.disposed || !this.isCurrentEditor()) return;
    const f = this.byId(fid);
    const m = f?.matches[idx];
    if (!f || !m || !f.blockEl || m.applied || m.to === undefined) return;
    const res = resolveSite(f.blockEl, m);
    if (res.status !== 'ok') {
      m.stale = true;
      return;
    }
    const startIdx = indexOfRange(f.blockEl, res.range);
    if (!applyReplacement(res.range, m.to)) {
      m.stale = true;
      return;
    }
    // undo 用に、適用後の to の前後文脈を採取する。挿入位置の直読みが合わない場合は
    // from→to で置き換わった箇所を後方文脈で探す
    const text = blockText(f.blockEl);
    const to = m.to;
    const at = startIdx !== null && text.slice(startIdx, startIdx + to.length) === to
      ? startIdx
      : occurrences(text, to).find((i) => contextOf(text, i, to.length).after === m.after);
    if (at !== undefined) {
      const c = contextOf(text, at, to.length);
      m.undoBefore = c.before;
      m.undoAfter = c.after;
    }
    m.applied = true;
    // undo 用文脈を採れなかった適用は「元に戻す」が効かないため stale として表面化する
    m.stale = at === undefined;
    if (startIdx !== null) this.refreshAfterEdit(f.blockEl, startIdx, m.to.length - m.from.length, m);
    this.syncResolved(f);
    this.s.selectedId = null;
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
        if (m === justApplied) continue;
        if (m.applied) {
          // 適用済み箇所の undo アンカーもずれるので採り直す（取れなければ revert 時に stale 判定される）
          const at = m.to === ''
            ? seamIndex(text, m.undoBefore ?? '', m.undoAfter ?? '')
            : (() => {
                const res = resolveSite(blockEl, undoSite(m), text);
                return res.status === 'ok' ? indexOfRange(blockEl, res.range) : null;
              })();
          if (at !== null) {
            const c = contextOf(text, at, m.to?.length ?? 0);
            m.undoBefore = c.before;
            m.undoAfter = c.after;
          }
          continue;
        }
        if (resolveSite(blockEl, m, text).status === 'ok') continue;
        const shifted = m.start > editStart ? m.start + delta : m.start;
        if (text.slice(shifted, shifted + m.from.length) !== m.from) {
          m.stale = true;
          continue;
        }
        this.recapture(m, text, shifted);
      }
    }
  }

  /** 位置がずれた箇所の start・前後文脈・出現番号を現在の本文から採り直す */
  private recapture(m: MatchSite, text: string, start: number) {
    m.start = start;
    const c = contextOf(text, start, m.from.length);
    m.before = c.before;
    m.after = c.after;
    m.occurrence = occurrences(text, m.from).indexOf(start);
  }

  /** カードの「適用」はその指摘の未適用の全箇所を適用する */
  private applyFinding(fid: string) {
    const f = this.byId(fid);
    if (!f) return;
    for (const [i, m] of f.matches.entries()) {
      if (!m.applied && m.to !== undefined && !m.stale) this.applyMatchCore(fid, i);
    }
    this.render();
  }

  private setFindingState(f: Finding, state: Finding['state']) {
    if (f.state === state) return;
    f.state = state;
    f.handledOrder = state === 'open' ? undefined : ++this.handledSequence;
  }

  private syncResolved(f: Finding) {
    const allApplied = f.matches.length > 0 && f.matches.every((m) => m.applied);
    this.setFindingState(f, allApplied ? 'resolved' : 'open');
  }

  /** 適用済み → 各箇所を原文へ戻す（それぞれ1編集操作）。削除 → 未対応へ復元 */
  private revert(fid: string) {
    if (this.disposed || !this.isCurrentEditor()) return;
    const f = this.byId(fid);
    if (!f) return;
    if (f.state === 'deleted') {
      this.setFindingState(f, 'open');
      this.s.selectedId = null;
      this.render();
      return;
    }
    for (const m of f.matches) {
      if (!m.applied || m.to === undefined || !f.blockEl) continue;
      // 削除提案（to=''）は挿入点を縫い目で解決する
      const res = m.to === ''
        ? (() => {
            const at = seamIndex(blockText(f.blockEl), m.undoBefore ?? '', m.undoAfter ?? '');
            const range = at !== null ? rangeAt(f.blockEl, at, 0) : null;
            return range ? { status: 'ok' as const, range } : { status: 'stale' as const };
          })()
        : resolveSite(f.blockEl, undoSite(m));
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
        if (text.slice(at, at + m.from.length) === m.from) this.recapture(m, text, at);
        this.refreshAfterEdit(f.blockEl, at, m.from.length - m.to.length, m);
      }
    }
    this.syncResolved(f);
    this.s.selectedId = null;
    this.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.staleRaf);
    this.stopPanelWatch?.();
    this.stopConfigWatch?.();
    ++this.providerLoad;
    this.deco.dispose();
    this.host.remove();
  }
}
