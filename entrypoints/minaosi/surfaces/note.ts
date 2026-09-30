import type { SurfaceAdapter } from './types';
import type { DraftBlock } from '../types';
import { blockText } from './resolve';

/**
 * editor.note.com の adapter。
 * 本文はページ内で最大の contenteditable とみなし、直下の子要素をブロックとする。
 * （note の内部 DOM 構造に依存しないよう、ブロック=直下要素のテキストで解決する）
 */
export const noteAdapter: SurfaceAdapter = {
  id: 'note',

  findEditor(doc) {
    // 本文は最大の editable。比較は textContent.length のみで十分（正規化は長さを変えない）
    let best: HTMLElement | null = null;
    let bestLen = -1;
    for (const el of doc.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable=""]')) {
      if (el.getClientRects().length === 0) continue;
      const len = el.textContent?.length ?? 0;
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }
    return best;
  },

  extractBlocks(editor) {
    const children = [...editor.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
    const targets = children.length > 0 ? children : [editor];
    return targets.map((element, index): DraftBlock => ({ index, element, text: blockText(element) }));
  },
};
