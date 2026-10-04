import type { MatchSite } from '../types';

/** ブロック本文中の文字列を Range に解決する。編集でずれた箇所は前後文脈で stale を判定する。 */

export type ResolveResult =
  | { status: 'ok'; range: Range }
  | { status: 'stale' }
  | { status: 'ambiguous' };

const CTX = 32;
const EXCLUDED_CONTENT = '[contenteditable="false"], button, input, textarea, select, script, style';
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 共通の前後を除き、文字の途中を切らない最小の置換と原文からの位置差を返す。 */
export function minimalReplacement(from: string, to: string): { from: string; to: string; offset: number } | null {
  if (from === to) return null;
  const before = [...graphemes.segment(from)].map(part => part.segment);
  const after = [...graphemes.segment(to)].map(part => part.segment);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  // 空の原文は現在のアンカーで解決できないため、挿入だけの案には隣接文字を残す。
  if (prefix + suffix === before.length) {
    if (prefix > 0) prefix--;
    else if (suffix > 0) suffix--;
    else return null;
  }
  return {
    from: before.slice(prefix, before.length - suffix).join(''),
    to: after.slice(prefix, after.length - suffix).join(''),
    offset: before.slice(0, prefix).join('').length,
  };
}

export function blockText(el: HTMLElement): string {
  const walker = textWalker(el);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += node.textContent ?? '';
  return text.replace(/\u00a0/g, ' ');
}

/** 編集不可のカードや操作部品を、送信本文とRangeの文字位置の双方から除く。 */
function textWalker(block: HTMLElement): TreeWalker {
  const rootExcluded = block.matches(EXCLUDED_CONTENT);
  return block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (rootExcluded) return NodeFilter.FILTER_REJECT;
      if (node instanceof Element) return node.matches(EXCLUDED_CONTENT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
}

export function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

export function contextOf(text: string, start: number, len: number): { before: string; after: string } {
  return {
    before: text.slice(Math.max(0, start - CTX), start),
    after: text.slice(start + len, start + len + CTX),
  };
}

/**
 * from がブロック内の occurrence 番目に出る箇所の前後文脈を採取する。
 * レビュー時点の位置を記録し、後の再解決で編集検出に使う。
 */
export function captureSite(
  block: HTMLElement,
  from: string,
  occurrence: number,
): { before: string; after: string; start: number } | null {
  return captureInText(blockText(block), from, occurrence);
}

/** テキスト（送信時のスナップショット）から文脈を採取する */
export function captureInText(
  text: string,
  from: string,
  occurrence: number,
): { before: string; after: string; start: number } | null {
  const start = occurrences(text, from)[occurrence];
  if (start === undefined) return null;
  return { ...contextOf(text, start, from.length), start };
}

/** before+after が縫い目で一致する位置（削除提案を元に戻す際の挿入点） */
export function seamIndex(text: string, before: string, after: string): number | null {
  const needle = before + after;
  if (!needle) return null;
  const starts = occurrences(text, needle);
  return starts.length === 1 ? starts[0]! + before.length : null;
}

export function rangeAt(block: HTMLElement, start: number, length: number): Range | null {
  const walker = textWalker(block);
  let acc = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    if (!startNode && (start < acc + len || (length === 0 && start === acc + len))) {
      startNode = n;
      startOff = start - acc;
    }
    if (startNode && start + length <= acc + len) {
      const r = block.ownerDocument.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(n, start + length - acc);
      // 文字列が連続して見えても、間の編集不可カードまで置換してはならない。
      if (r.cloneContents().querySelector(EXCLUDED_CONTENT)) return null;
      return r;
    }
    acc += len;
  }
  return null;
}

/**
 * site を現在のブロック本文に再解決する。
 * 前後文脈が一致する出現が1つだけのとき Range を返す。0件=編集済み（stale）、
 * 2件以上=一意に特定できない（ambiguous）として誤適用を防ぐ。
 */
export function resolveSite(
  block: HTMLElement,
  site: { from: string; before: string; after: string },
  text = blockText(block),
): ResolveResult {
  const starts = occurrences(text, site.from);
  const hits = starts.filter((i) => {
    const c = contextOf(text, i, site.from.length);
    return c.before === site.before && c.after === site.after;
  });
  if (hits.length === 1) {
    const range = rangeAt(block, hits[0]!, site.from.length);
    return range ? { status: 'ok', range } : { status: 'ambiguous' };
  }
  if (hits.length === 0) return { status: 'stale' };
  return { status: 'ambiguous' };
}

/** 適用済み箇所を元に戻すための解決引数（現在の本文上の `to` を探す） */
export function undoSite(m: MatchSite): { from: string; before: string; after: string } {
  return { from: m.to ?? '', before: m.undoBefore ?? '', after: m.undoAfter ?? '' };
}

/** Range の開始位置をブロック本文中の文字 index に戻す（適用後の undo 文脈採取用） */
export function indexOfRange(block: HTMLElement, range: Range): number | null {
  const walker = textWalker(block);
  let acc = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n === range.startContainer) return acc + range.startOffset;
    acc += n.data.length;
  }
  return null;
}

/**
 * contenteditable の選択範囲を range に合わせて insertText で置き換える。
 * ブラウザの編集履歴の1操作として積まれるため、エディタの undo と矛盾しない。
 */
export function applyReplacement(range: Range, to: string): boolean {
  const node = range.startContainer;
  const host = (node instanceof Element ? node : node.parentElement)?.closest(
    '[contenteditable]',
  ) as HTMLElement | null;
  host?.focus();
  const sel = (node.ownerDocument ?? document).getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  try {
    // execCommand は deprecated だが、contenteditable の編集履歴（Cmd+Z）に乗せる唯一の手段。
    // 失敗時は呼び出し側が stale にして再見直しを促す
    return document.execCommand('insertText', false, to);
  } catch {
    return false;
  }
}
