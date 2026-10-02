import { blockText, indexOfRange, rangeAt } from '../surfaces/resolve';

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
}

const TEXT_ELEMENTS = /^(P|H[1-6]|BLOCKQUOTE|SPAN|STRONG|B|EM|I|S|U|A|CODE|BR)$/;
const TEXT_STYLE = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'letter-spacing', 'line-height', 'text-align', 'text-transform', 'text-decoration', 'white-space', 'word-break', 'overflow-wrap', 'direction', 'color'];

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
    window.addEventListener('blur', review);
    this.root.addEventListener('pointerdown', event => this.enterEditor(event));
    this.stops.push(() => document.removeEventListener('focusin', edit), () => window.removeEventListener('blur', review));
  }

  setEditor(editor: HTMLElement) { this.editor = editor; this.revision = ''; }

  private setEditing(editing: boolean) {
    if (editing === this.editing) return;
    this.editing = editing;
    this.revision = '';
    if (editing) this.clear();
    this.changed();
  }

  render(sites: InlineSite[], selectedId: string | null, dirty: boolean) {
    if (this.editing) return;
    const revision = `${selectedId}:${sites.length}:${this.editor.getBoundingClientRect().width}`;
    if (dirty || revision !== this.revision) {
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
      if (!block || !block.id || !TEXT_ELEMENTS.test(block.tagName)
        || [...block.querySelectorAll('*')].some(el => !TEXT_ELEMENTS.test(el.tagName))) continue;
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
      Object.assign(element.style, { position: 'fixed', boxSizing: 'border-box', margin: '0', padding: '0', width: `${source.getBoundingClientRect().width}px` });
      const drawn = new Map<InlineSite, HTMLElement>();
      const placements = group.map(site => ({ site, start: indexOfRange(source, site.range!) }))
        .filter((item): item is { site: InlineSite; start: number } => item.start !== null)
        .sort((a, b) => b.start - a.start);
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
      this.previews.push({ source, element, sites: drawn });
      rules.push(`#${CSS.escape(source.id)} { min-height: ${element.getBoundingClientRect().height}px !important; }`);
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
      if (change) return change.querySelector<HTMLElement>('.inline-after') ?? undefined;
    }
  }

  private enterEditor(event: PointerEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-fid]')) { event.preventDefault(); return; }
    const preview = this.previews.find(item => item.element.contains(target));
    if (!preview) return;
      const caret = document.caretPositionFromPoint(event.clientX, event.clientY, { shadowRoots: [this.shadow] });
    if (!caret || !preview.element.contains(caret.offsetNode)) return;
    let offset = 0;
    const walker = document.createTreeWalker(preview.element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === caret.offsetNode) { offset += caret.offset; break; }
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
}
