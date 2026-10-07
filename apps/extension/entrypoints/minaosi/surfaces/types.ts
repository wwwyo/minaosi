import type { DraftBlock } from '../types';

export type EditorStatus = 'confirmed' | 'unknown' | 'none';
export type ReviewTrigger = 'manual' | 'automatic';

export type EditorDetection =
  | { status: 'confirmed'; editor: HTMLElement }
  | { status: 'unknown'; candidates: HTMLElement[] }
  | { status: 'none' };

/** 手動で選んだ未判定の領域を、自動実行の対象へ昇格させない。 */
export function selectReviewEditor(detection: EditorDetection, trigger: ReviewTrigger, selected: HTMLElement | null): HTMLElement | null {
  if (detection.status === 'confirmed') return detection.editor;
  return trigger === 'manual' && detection.status === 'unknown' && selected && detection.candidates.includes(selected) ? selected : null;
}

/** 入力方式ごとの全文取得とアンカーの差分を隔離する。 */
export interface SurfaceAdapter {
  id: string;
  /** 本文の編集領域の判定と、手動で選べる未判定の候補。 */
  detectEditor(doc: Document): EditorDetection;
  /** 文書順のブロック一覧。画像・改行など本文の無いブロックも index を消費する */
  extractBlocks(editor: HTMLElement): DraftBlock[];
}
