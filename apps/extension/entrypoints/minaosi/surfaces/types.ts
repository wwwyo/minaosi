import type { DraftBlock } from '../types';

/** 入力方式ごとの全文取得とアンカーの差分を隔離する。 */
export interface SurfaceAdapter {
  id: string;
  /** 本文の編集領域。複数のeditableをまとめる領域も含む。確定できなければnull。 */
  findEditor(doc: Document): HTMLElement | null;
  /** 文書順のブロック一覧。画像・改行など本文の無いブロックも index を消費する */
  extractBlocks(editor: HTMLElement): DraftBlock[];
}
