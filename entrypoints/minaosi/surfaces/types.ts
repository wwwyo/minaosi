import type { DraftBlock } from '../types';

/** surface 差分は adapter に隔離する。v1 の実装は editor.note.com のみ。 */
export interface SurfaceAdapter {
  id: string;
  /** 本文の editable root。エディタ画面でない・未描画なら null */
  findEditor(doc: Document): HTMLElement | null;
  /** 文書順のブロック一覧。画像・改行など本文の無いブロックも index を消費する */
  extractBlocks(editor: HTMLElement): DraftBlock[];
}
