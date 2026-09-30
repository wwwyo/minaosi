import { browser } from '#imports';
import type { DraftBlock, Finding, MatchSite } from './types';
import type { SurfaceAdapter } from './surfaces/types';
import { blockText, captureInText, contextOf, indexOfRange, occurrences, applyReplacement, rangeAt, resolveSite, seamIndex, undoSite } from './surfaces/resolve';
import { buildRequest, parseReport, type ReviewedFinding } from './review/prompt';
import { LANGUAGE_RULES } from './rubric';
import { apiKeyItem, modelItem, consentedItem, ruleTogglesItem, styleGuideItem } from './store';
import { Decorations } from './ui/decorations';
import { renderPanel, wirePanel, type PanelState } from './ui/panel';
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
    // closed: ページ側 JS から API key 入力値などを読まれないよう host.shadowRoot を閉じる
    this.shadow = this.host.attachShadow({ mode: 'closed' });
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
      onUnapplied: (fid, idx) => this.markUnapplied(fid, idx),
    });

    wirePanel(this.shadow as unknown as HTMLElement, {
      onFab: () => this.toggle(),
      onRun: () => void this.run(),
      onTogglePanel: () => this.togglePanel(),
      onFilter: (f) => { this.s.filter = f; this.render(); },
      onSelect: (fid) => this.select(fid),
      onApplyFinding: (fid) => this.applyFinding(fid),
      onDelete: (fid) => {
        const f = this.byId(fid);
        if (!f) return;
        f.state = 'deleted';
        this.s.selectedId = null;
        this.render();
      },
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
    if (editor === this.editor) return;
    this.editor = editor;
    this.deco.setEditor(editor);
    if (this.s.findings.length) {
      // SPA 遷移等でエディタ DOM が差し替わった場合、ブロック index で再アンカーを試みる
      const blocks = this.adapter.extractBlocks(editor);
      for (const f of this.s.findings) {
        const b = f.block >= 0 ? blocks[f.block] : undefined;
        f.blockEl = b?.index === f.block ? b.element : undefined;
      }
      this.render();
    }
  }

  private byId(fid: string) {
    return this.s.findings.find((f) => f.id === fid);
  }

  /** 開閉アニメの方向（in は mount 時のみ付与、out は退出中のみ付与） */
  private anim: 'in' | 'out' | null = null;

  private render() {
    const { panel, fab } = renderPanel(this.s, this.anim ?? undefined);
    this.panelRoot.innerHTML = panel;
    this.fabRoot.innerHTML = fab;
    this.deco.render(this.s.findings, this.s.selectedId, this.s.panelOpen);
    // パネルは本文の上に被せるのではなく右に置く — 本文の幅をパネル分だけ縮める
    // （prototype の .with-panel と同じ位置付け。position:fixed のホスト側 chrome は
    //  viewport 基準なので動かず、パネルの下に隠れる点は v1 では許容する）
    document.body.style.marginRight = this.s.panelOpen ? '340px' : '';
  }

  /** FAB・ツールバーアイコン共通のエントリ: 未レビューなら校閲実行、済みならパネル開閉 */
  toggle() {
    if (this.s.phase === 'done' || this.s.phase === 'error') this.togglePanel();
    else void this.run();
  }

  /** パネルを開く（右下からの入場アニメ付き）。すでに開いていれば何もしない */
  private openPanel() {
    if (this.s.panelOpen) return;
    this.s.panelOpen = true;
    this.anim = 'in';
    // in アニメは mount 時の1回だけ。class が残ると再描画ごとに再生されるので外す
    setTimeout(() => { this.anim = null; }, 240);
  }

  private togglePanel() {
    const opening = !this.s.panelOpen;
    if (opening) {
      this.openPanel();
      this.render();
      return;
    }
    this.s.view = 'list';
    // 退出アニメが終わるまでは panelOpen のまま描画し、終了後に取り外す
    this.anim = 'out';
    this.render();
    setTimeout(() => {
      if (this.anim !== 'out') return;
      this.anim = null;
      this.s.panelOpen = false;
      this.render();
    }, 230);
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

  /* ---- 見直す ---- */

  async run() {
    if (this.s.phase === 'running') return;
    if (!this.s.apiKey) {
      this.openPanel();
      this.s.view = 'settings';
      this.render();
      return;
    }
    if (!this.s.consented) {
      this.openPanel();
      this.s.view = 'consent';
      this.render();
      return;
    }
    this.s.phase = 'running';
    this.openPanel();
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
          matches.push({
            occurrence: nth, start: cap.start, from: m.from, to: m.to,
            before: cap.before, after: cap.after, applied: false, stale: false,
          });
        }
      }
      out.push({
        id: `f${i}`,
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
    document.body.style.marginRight = '';
    this.deco.dispose();
    this.host.remove();
  }
}
