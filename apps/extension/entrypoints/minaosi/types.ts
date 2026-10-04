import type { ReviewedFinding } from '@minaosi/api/rpc';

/** ブラウザ上の指摘・修正案・状態。通信形式の型はAPIルートを参照する。 */

export type FindingKind = ReviewedFinding['kind'];
export type FindingState = 'open' | 'resolved' | 'deleted';

export const KIND_LABEL: Record<FindingKind, string> = {
  typo: '誤字',
  fact: '事実',
  rule: '日本語ルール',
  style: '文体',
};

export interface Source {
  url: string;
  label: string;
  /** 出典内の該当箇所（根拠の引用や見出し名） */
  excerpt?: string;
}

export interface MatchSite {
  /** レビュー時点のブロック本文中での `from` の出現番号（0始まり） */
  occurrence: number;
  /** 最後に確定したブロック本文中の開始位置。適用・手編集後の位置追従に使う */
  start: number;
  from: string;
  /** 修正案。無い場合は指摘のみ（適用不可） */
  to?: string;
  /** stale 判定用にレビュー時点で採取した前後文脈 */
  before: string;
  after: string;
  /** 適用後の「元に戻す」用：適用時点で採取した `to` の前後文脈 */
  undoBefore?: string;
  undoAfter?: string;
  applied: boolean;
  /** 適用時の再解決に失敗（原文と不一致/一意でない）。再見直しを促す */
  stale: boolean;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  /** extractBlocks() の index。アンカーを特定できない指摘は -1 */
  block: number;
  /** アンカー先ブロック要素。index は兄弟挿入でずれるため要素参照を持つ */
  blockEl?: HTMLElement;
  title: string;
  reason: string;
  matches: MatchSite[];
  /** kind === 'fact' のとき必須 */
  source?: Source;
  state: FindingState;
  /** 対応済みに移った順番。復元後に再対応すると末尾へ積み直す。 */
  handledOrder?: number;
}

export interface DraftBlock {
  index: number;
  element: HTMLElement;
  text: string;
}
