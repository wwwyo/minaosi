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
    const cands = [...doc.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable=""]')]
      .filter((el) => el.getClientRects().length > 0);
    return cands.sort((a, b) => blockText(b).length - blockText(a).length)[0] ?? null;
  },

  extractBlocks(editor) {
    const children = [...editor.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    );
    const targets = children.length > 0 ? children : [editor];
    return targets.map((element, index): DraftBlock => ({ index, element, text: blockText(element) }));
  },
};
