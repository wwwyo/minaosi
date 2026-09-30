import type { Finding } from '../types';
import { resolveSite } from '../surfaces/resolve';
import { PAGE_HIGHLIGHT_CSS } from './styles';
import { ICON_APPLY } from './icons';

/**
 * 本文上の重ね表示。contenteditable の DOM には一切触れず、
 * CSS Custom Highlight（取り消し線・選択 tint）と position:fixed の overlay 層で描く。
 * host のシリアライズに差分が混入しないよう、修正案のテキストは overlay のみに置く。
 */

interface Site {
  fid: string;
  matchIndex: number;
  kind: 'suggest' | 'mark' | 'block' | 'applied';
  rects: DOMRect[];
  range?: Range;
  el?: HTMLElement;
  to?: string;
  from?: string;
}

export interface DecorationCallbacks {
  onSelect: (fid: string) => void;
  onApplyMatch: (fid: string, matchIndex: number) => void;
  /** 表示時に解決不能になった箇所を報告する（stale 表示に使う） */
  onUnresolvable: (fid: string, matchIndex: number, stale: boolean) => void;
}

const HL_SUPPORTED = typeof CSS !== 'undefined' && 'highlights' in CSS;

export class Decorations {
  private ovl: HTMLElement;
  private tip: HTMLElement;
  private delHl: Highlight | null = null;
  private selHl: Highlight | null = null;
  private raf = 0;
  private disposers: (() => void)[] = [];
  private findings: Finding[] = [];
  private selectedId: string | null = null;
  private tipTimer = 0;
  private pageStyle: HTMLStyleElement | null = null;
  private mo: MutationObserver | null = null;

  constructor(
    private shadow: ShadowRoot,
    private editor: HTMLElement,
    private cbs: DecorationCallbacks,
  ) {
    this.ovl = document.createElement('div');
    this.ovl.className = 'mn ovl';
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.innerHTML = `<button type="button">${ICON_APPLY}適用</button>`;
    shadow.append(this.ovl, this.tip);

    if (HL_SUPPORTED) {
      this.delHl = new Highlight();
      this.selHl = new Highlight();
      this.selHl.priority = 1;
      (CSS.highlights as HighlightRegistry).set('minaosi-del', this.delHl);
      (CSS.highlights as HighlightRegistry).set('minaosi-sel', this.selHl);
      this.pageStyle = document.createElement('style');
      this.pageStyle.textContent = PAGE_HIGHLIGHT_CSS;
      document.head.appendChild(this.pageStyle);
    }

    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(this.editor, { childList: true, characterData: true, subtree: true });
    const onScroll = () => this.schedule();
    const onResize = () => this.schedule();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    const interval = setInterval(() => this.schedule(), 1500);
    const onLeave = (e: Event) => this.handleLeave(e);
    this.ovl.addEventListener('mouseover', (e) => this.handleOver(e));
    this.ovl.addEventListener('mouseout', onLeave);
    this.ovl.addEventListener('click', (e) => this.handleClick(e));
    this.tip.addEventListener('mouseenter', () => clearTimeout(this.tipTimer));
    this.tip.addEventListener('mouseleave', () => this.hideTip());
    this.tip.querySelector('button')?.addEventListener('click', () => {
      const key = this.tip.dataset.apply;
      if (!key) return;
      const [fid, idx] = key.split(':');
      if (fid === undefined) return;
      this.hideTip();
      this.cbs.onApplyMatch(fid, Number(idx));
    });

    this.disposers.push(
      () => this.mo?.disconnect(),
      () => window.removeEventListener('scroll', onScroll, { capture: true }),
      () => window.removeEventListener('resize', onResize),
      () => clearInterval(interval),
    );
  }

  setEditor(editor: HTMLElement) {
    if (editor === this.editor) return;
    this.editor = editor;
    this.mo?.disconnect();
    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(editor, { childList: true, characterData: true, subtree: true });
    this.schedule();
  }

  render(findings: Finding[], selectedId: string | null) {
    this.findings = findings;
    this.selectedId = selectedId;
    this.schedule();
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.recompute();
    });
  }

  private buildSites(): Site[] {
    const sites: Site[] = [];
    for (const f of this.findings) {
      if (f.state === 'deleted') continue;
      const selected = f.id === this.selectedId;
      const blockEl = f.blockEl;
      if (!blockEl || !blockEl.isConnected) {
        for (const [i] of f.matches.entries()) this.cbs.onUnresolvable(f.id, i, true);
        continue;
      }
      for (const [i, m] of f.matches.entries()) {
        if (m.applied) {
          if (!selected || !m.to || m.undoBefore === undefined) continue;
          const res = resolveSite(blockEl, { from: m.to, before: m.undoBefore, after: m.undoAfter ?? '' });
          if (res.status === 'ok') {
            sites.push({
              fid: f.id, matchIndex: i, kind: 'applied',
              rects: [...res.range.getClientRects()], range: res.range, from: m.from,
            });
          }
          continue;
        }
        const res = resolveSite(blockEl, m);
        if (res.status !== 'ok') {
          this.cbs.onUnresolvable(f.id, i, true);
          continue;
        }
        this.cbs.onUnresolvable(f.id, i, false);
        sites.push({
          fid: f.id, matchIndex: i,
          kind: m.to !== undefined ? 'suggest' : 'mark',
          rects: [...res.range.getClientRects()], range: res.range, to: m.to,
        });
      }
      if (f.matches.length === 0 && f.state === 'open') {
        const r = blockEl.getBoundingClientRect();
        if (r.width > 0) sites.push({ fid: f.id, matchIndex: -1, kind: 'block', rects: [r], el: blockEl });
      }
    }
    return sites;
  }

  private recompute() {
    this.delHl?.clear();
    this.selHl?.clear();
    this.ovl.textContent = '';
    const sites = this.buildSites();

    for (const s of sites) {
      const selected = s.fid === this.selectedId;
      if (s.kind === 'suggest' && s.range) {
        if (this.delHl) this.delHl.add(s.range);
        else for (const r of s.rects) this.el('strike-line', r.left, r.top + r.height / 2, r.width, 0);
        const last = s.rects[s.rects.length - 1];
        if (last) this.insChip(s, last);
      }
      if (s.kind === 'applied' && s.range) {
        this.selHl?.add(s.range);
        const first = s.rects[0];
        if (first && s.from !== undefined) this.delChip(s, first);
      }
      if ((s.kind === 'suggest' || s.kind === 'mark') && s.range) {
        if (selected) this.selHl?.add(s.range);
        // 打ち消し線が見えている箇所だけポインタを取る。修正案の無い mark は
        // 不可視のままポインタを奪うと文字選択を阻害するため hot-rect を置かない
        if (s.kind === 'suggest') {
          for (const r of s.rects) {
            const hot = this.el('hot', r.left - 1, r.top - 1, r.width + 2, r.height + 2);
            hot.dataset.fid = s.fid;
            hot.dataset.idx = String(s.matchIndex);
            hot.dataset.suggest = '1';
          }
        }
      }
      if (s.kind === 'block') {
        const r = s.rects[0];
        if (!r) continue;
        const bar = this.el('bbar', r.left - 10, r.top, 3, r.height);
        bar.dataset.fid = s.fid;
        if (selected) bar.dataset.sel = '';
      }
      if (selected && s.kind !== 'block') {
        for (const r of s.rects) this.el('ring', r.left - 2, r.top - 2, r.width + 4, r.height + 4);
      }
    }
  }

  private el(cls: string, l: number, t: number, w: number, h: number): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    d.style.left = `${l}px`;
    d.style.top = `${t}px`;
    if (w) d.style.width = `${w}px`;
    if (h) d.style.height = `${h}px`;
    this.ovl.appendChild(d);
    return d;
  }

  /** 修正案の挿入候補チップ。原文の行末に重ね、右にはみ出す場合は行の上に置く */
  private insChip(s: Site, last: DOMRect) {
    const chip = document.createElement('span');
    chip.className = 'sug-ins';
    chip.dataset.fid = s.fid;
    chip.dataset.idx = String(s.matchIndex);
    chip.dataset.suggest = '1';
    chip.textContent = s.to ?? '';
    this.ovl.appendChild(chip);
    const w = chip.offsetWidth;
    const h = chip.offsetHeight;
    let left = last.right + 3;
    let top = last.top + (last.height - h) / 2;
    if (left + w > window.innerWidth - 344) {
      left = s.rects[0]?.left ?? last.left;
      top = (s.rects[0]?.top ?? last.top) - h - 2;
    }
    chip.style.left = `${Math.max(4, left)}px`;
    chip.style.top = `${top}px`;
  }

  /** 適用済みプレビュー：現在の本文は to。差分を示すため from を打ち消しチップで行の上に出す */
  private delChip(s: Site, first: DOMRect) {
    const chip = document.createElement('span');
    chip.className = 'sug-del';
    chip.dataset.fid = s.fid;
    chip.textContent = s.from ?? '';
    this.ovl.appendChild(chip);
    chip.style.left = `${Math.max(4, first.left)}px`;
    chip.style.top = `${first.top - chip.offsetHeight - 2}px`;
  }

  /* ---- tooltip / hit-test ---- */

  private siteOf(el: HTMLElement | null): { fid: string; idx: number } | null {
    const t = el?.closest('[data-fid]') as HTMLElement | null;
    if (!t || !t.dataset.fid) return null;
    return { fid: t.dataset.fid, idx: Number(t.dataset.idx ?? -1) };
  }

  private handleOver(e: Event) {
    const t = e.target as HTMLElement;
    const s = this.siteOf(t);
    if (!s) return;
    const host = t.closest('.hot, .sug-ins') as HTMLElement | null;
    if (host?.dataset.suggest) {
      clearTimeout(this.tipTimer);
      this.showTip(s.fid, s.idx, e as MouseEvent, host);
    }
  }

  private handleLeave(e: Event) {
    const t = e.target as HTMLElement;
    if (!t.closest('.hot, .sug-ins')) return;
    const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
    if (related && (related.closest('.hot, .sug-ins') || this.tip.contains(related))) return;
    this.tipTimer = window.setTimeout(() => this.hideTip(), 120);
  }

  private showTip(fid: string, idx: number, e: MouseEvent, host: HTMLElement) {
    // 折り返し行ではカーソルがある行に合わせる
    const rects = [...host.getClientRects()];
    const line = rects.find((r) => e.clientY >= r.top - 2 && e.clientY <= r.bottom) ?? rects[0];
    if (!line) return;
    this.tip.dataset.apply = `${fid}:${idx}`;
    this.tip.classList.add('on');
    const half = this.tip.offsetWidth / 2;
    const cx = Math.min(Math.max(e.clientX, half + 8), window.innerWidth - half - 8);
    this.tip.style.left = `${cx}px`;
    this.tip.style.top = `${line.top - 2}px`;
  }

  private hideTip() {
    this.tip.classList.remove('on');
    delete this.tip.dataset.apply;
  }

  private handleClick(e: Event) {
    const t = e.target as HTMLElement;
    const s = this.siteOf(t);
    if (s) this.cbs.onSelect(s.fid);
  }

  /** カード選択時：該当箇所へスクロールして一瞬フラッシュする */
  flash(fid: string) {
    const f = this.findings.find((x) => x.id === fid);
    if (!f?.blockEl) return;
    let target: HTMLElement | null = f.blockEl;
    for (const m of f.matches) {
      if (m.applied) continue;
      const res = resolveSite(f.blockEl, m);
      if (res.status === 'ok') {
        target = res.range.startContainer instanceof Element
          ? (res.range.startContainer as HTMLElement)
          : res.range.startContainer.parentElement;
        const rects = [...res.range.getClientRects()];
        const r = rects[0];
        if (r) this.showFlash(r);
        break;
      }
    }
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (f.matches.length === 0 || f.matches.every((m) => m.applied)) {
      const r = f.blockEl.getBoundingClientRect();
      this.showFlash(r);
    }
    // 本文の文字数変化で raf 後に再描画されるため、scroll 後にもう一度 position 同期
    this.schedule();
  }

  private showFlash(r: DOMRect) {
    const el = this.el('flash', r.left - 6, r.top - 6, r.width + 12, r.height + 12);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      }, 450);
    });
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.delHl?.clear();
    this.selHl?.clear();
    if (HL_SUPPORTED) {
      (CSS.highlights as HighlightRegistry).delete('minaosi-del');
      (CSS.highlights as HighlightRegistry).delete('minaosi-sel');
    }
    this.pageStyle?.remove();
    this.ovl.remove();
    this.tip.remove();
  }
}

type HighlightRegistry = Map<string, Highlight>;
