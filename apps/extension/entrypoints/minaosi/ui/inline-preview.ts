import { blockText, indexOfRange, rangeAt } from '../surfaces/resolve';
import { planInlineChanges } from './inline-preview-layout';

export interface InlineSite {
  fid: string;
  matchIndex: number;
  kind: 'suggest' | 'mark' | 'block' | 'applied';
  range?: Range;
  from?: string;
  to?: string;
}

interface Preview {
  source: HTMLElement;
  element: HTMLElement;
  sites: Map<InlineSite, HTMLElement>;
  width: number;
}

const REPLACED_ELEMENTS = 'img,video,audio,iframe,hr,svg,math,object,embed,script,style,input,textarea,button,select';
const TEXT_STYLE = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'letter-spacing', 'line-height', 'text-align', 'text-indent', 'text-transform', 'text-decoration', 'white-space', 'word-break', 'overflow-wrap', 'direction', 'color', 'vertical-align', 'padding', 'border', 'box-sizing', 'display', 'margin', 'list-style'];

/** 原稿に識別属性を追加しないよう、既存IDかDOM上の位置で高さの規則を限定する。 */
function selectorFor(element: HTMLElement): string {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parent = element.parentElement;
  if (!parent) return element.tagName.toLowerCase();
  const index = [...parent.children].indexOf(element) + 1;
  return `${selectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-child(${index})`;
}

/** 原稿のDOMを編集せず、校閲中だけ本文と候補を行内に組んだ表示を重ねる。 */
export class InlinePreview {
  private root = document.createElement('div');
  private style = document.createElement('style');
  private hidden = new Highlight();
  private previews: Preview[] = [];
  private editing = false;
  private revision = '';
  private stops: (() => void)[] = [];

  constructor(private shadow: ShadowRoot, private editor: HTMLElement, private changed: () => void) {
    this.root.className = 'mn inline-previews';
    shadow.append(this.root);
    document.head.append(this.style);
    this.hidden.priority = 10;
    CSS.highlights.set('minaosi-preview', this.hidden);
    const edit = (event: Event) => {
      this.setEditing(this.editor.contains(event.target as Node));
    };
    const review = () => this.setEditing(false);
    document.addEventListener('focusin', edit);
    document.addEventListener('beforeinput', edit);
    document.addEventListener('keydown', edit);
    window.addEventListener('blur', review);
    this.root.addEventListener('pointerdown', event => this.enterEditor(event));
    this.stops.push(
      () => document.removeEventListener('focusin', edit),
      () => document.removeEventListener('beforeinput', edit),
      () => document.removeEventListener('keydown', edit),
      () => window.removeEventListener('blur', review),
    );
  }

  setEditor(editor: HTMLElement) { this.clear(); this.editor = editor; this.revision = ''; }
  showReview() { this.setEditing(false); }
  invalidate() { this.revision = ''; this.root.hidden = true; }

  private setEditing(editing: boolean) {
    if (editing === this.editing) return;
    this.editing = editing;
    this.revision = '';
    if (editing) this.clear();
    this.changed();
  }

  render(sites: InlineSite[], selectedId: string | null, dirty: boolean) {
    if (this.editing) return;
    this.root.hidden = false;
    const revision = `${selectedId}:${sites.length}:${this.editor.getBoundingClientRect().width}`;
    if (dirty || revision !== this.revision || this.previews.some(p => p.source.getBoundingClientRect().width !== p.width)) {
      this.revision = revision;
      this.build(sites, selectedId);
    }
    this.position();
  }

  private build(sites: InlineSite[], selectedId: string | null) {
    this.root.replaceChildren();
    this.hidden.clear();
    this.previews = [];
    const groups = new Map<HTMLElement, InlineSite[]>();
    for (const site of sites) {
      if (!site.range || (site.kind !== 'suggest' && site.kind !== 'applied')) continue;
      let block = site.range.startContainer.parentElement;
      while (block && block.parentElement !== this.editor) block = block.parentElement;
      if (!block || block.matches(REPLACED_ELEMENTS) || block.querySelector(REPLACED_ELEMENTS)) continue;
      const group = groups.get(block) ?? [];
      group.push(site);
      groups.set(block, group);
    }
    const rules: string[] = [];
    for (const [source, group] of groups) {
      const element = source.cloneNode(true) as HTMLElement;
      const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
      const copies = [element, ...element.querySelectorAll<HTMLElement>('*')];
      copies.forEach((copy, index) => {
        for (const attr of [...copy.attributes]) copy.removeAttribute(attr.name);
        const computed = getComputedStyle(originals[index]!);
        for (const property of TEXT_STYLE) copy.style.setProperty(property, computed.getPropertyValue(property));
      });
      element.className = 'inline-preview';
      const width = source.getBoundingClientRect().width;
      Object.assign(element.style, { position: 'fixed', boxSizing: 'border-box', margin: '0', width: `${width}px` });
      const drawn = new Map<InlineSite, HTMLElement>();
      const positions = group.map(site => ({ site, fid: site.fid, start: indexOfRange(source, site.range!), length: site.range!.toString().length }))
        .filter((item): item is { site: InlineSite; fid: string; start: number; length: number } => item.start !== null);
      const placements = planInlineChanges(positions, selectedId);
      let boundary = blockText(source).length;
      for (const { site, start } of placements) {
        const length = site.range!.toString().length;
        if (start + length > boundary) continue;
        const range = rangeAt(element, start, length);
        if (!range) continue;
        const before = document.createElement('span');
        before.className = 'inline-before';
        const after = document.createElement('span');
        after.className = 'inline-after';
        const fragment = range.extractContents();
        if (site.kind === 'suggest') {
          before.append(fragment);
          after.textContent = site.to ?? '';
          after.dataset.insert = '';
          after.dataset.position = String(start + length);
        } else {
          before.textContent = site.from ?? '';
          before.dataset.insert = '';
          before.dataset.position = String(start);
          after.append(fragment);
        }
        const change = document.createElement('span');
        change.className = 'inline-change';
        change.dataset.fid = site.fid;
        change.dataset.idx = String(site.matchIndex);
        if (site.kind === 'suggest') change.dataset.suggest = '1';
        if (site.fid === selectedId) change.dataset.sel = '';
        change.append(before, after);
        range.insertNode(change);
        drawn.set(site, change);
        boundary = start;
      }
      if (!drawn.size) continue;
      this.root.append(element);
      const mask = document.createRange();
      mask.selectNodeContents(source);
      this.hidden.add(mask);
      this.previews.push({ source, element, sites: drawn, width });
      const computed = getComputedStyle(source);
      const edges = computed.boxSizing === 'border-box' ? 0
        : ['padding-top', 'padding-bottom', 'border-top-width', 'border-bottom-width']
          .reduce((sum, name) => sum + (parseFloat(computed.getPropertyValue(name)) || 0), 0);
      rules.push(`${selectorFor(source)} { min-height: ${Math.max(0, element.getBoundingClientRect().height - edges)}px !important; }`);
    }
    const css = rules.join('\n');
    if (this.style.textContent !== css) this.style.textContent = css;
  }

  private position() {
    for (const { source, element } of this.previews) {
      const bounds = source.getBoundingClientRect();
      element.style.left = `${bounds.left}px`;
      element.style.top = `${bounds.top}px`;
    }
  }

  rects(site: InlineSite): DOMRect[] | undefined {
    for (const preview of this.previews) {
      const element = preview.sites.get(site);
      if (element) return [...element.getClientRects()];
    }
  }

  candidate(site: InlineSite): HTMLElement | undefined {
    for (const preview of this.previews) {
      const change = preview.sites.get(site);
      if (change) {
        const after = change.querySelector<HTMLElement>('.inline-after');
        return after?.textContent ? after : change.querySelector<HTMLElement>('.inline-before') ?? undefined;
      }
    }
  }

  covers(site: InlineSite): boolean {
    return !!site.range && this.previews.some(preview => preview.source.contains(site.range!.startContainer));
  }

  private enterEditor(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-fid]')) { event.preventDefault(); return; }
    const preview = this.previews.find(item => item.element.contains(target));
    if (!preview) return;
    const caret = typeof document.caretPositionFromPoint === 'function'
      ? document.caretPositionFromPoint(event.clientX, event.clientY, { shadowRoots: [this.shadow] })
      : null;
    if (!caret || !preview.element.contains(caret.offsetNode)) return;
    const boundary = document.createRange();
    boundary.setStart(preview.element, 0);
    boundary.setEnd(caret.offsetNode, caret.offset);
    let offset = 0;
    const walker = document.createTreeWalker(boundary.cloneContents(), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest('[data-insert]')) offset += node.textContent?.length ?? 0;
    }
    event.preventDefault();
    this.setEditing(true);
    const range = rangeAt(preview.source, offset, 0);
    if (!range) return;
    this.editor.focus({ preventScroll: true });
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  private clear() {
    this.root.replaceChildren();
    this.previews = [];
    this.hidden.clear();
    this.style.textContent = '';
  }

  dispose() {
    this.stops.forEach(stop => stop());
    this.clear();
    this.root.remove();
    this.style.remove();
    CSS.highlights.delete('minaosi-preview');
  }

  get element() { return this.root; }
  get isEditing() { return this.editing; }
}
