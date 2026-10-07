import type { DraftBlock, Finding } from './types';

/**
 * 自動校閲の起動タイミングと、部分校閲の差分・マージ。
 * 起動判断はすべてルールベース（docs/prd/auto-review/design.md）。
 */

export const AUTO_REVIEW_INITIAL_DELAY_MS = 1_500;
export const AUTO_REVIEW_DEBOUNCE_MS = 4_000;
export const AUTO_REVIEW_MIN_INTERVAL_MS = 10_000;

export type AutoReviewState = 'on' | 'paused' | 'blocked';

/** 前回送信時と本文または要素が変わったブロックだけを返す。 */
export function dirtyBlocks(blocks: DraftBlock[], sent: ReadonlyMap<HTMLElement, string>): DraftBlock[] {
  return blocks.filter((b) => sent.get(b.element) !== b.text);
}

/** 指摘の同一性。編集後に同じ指摘が再報告されたかを判断する材料にする。 */
function findingSignature(f: Pick<Finding, 'kind' | 'title' | 'matches'>): string {
  const froms = f.matches.map((m) => m.from).sort();
  return `${f.kind}\n${f.title}\n${froms.join('\n')}`;
}

/**
 * 部分校閲の応答を現在の指摘一覧へマージする。
 * - 送ったブロックの指摘は新しい結果で置き換える
 * - 送らなかったブロックの指摘と対応状態（適用済み・削除）は残す
 * - 本文から外れたブロックに紐づく指摘は消す
 * - 削除した指摘と同じ指摘が再報告されたら削除の判断を引き継ぐ
 */
export function mergeFindings(current: Finding[], incoming: Finding[], sent: ReadonlySet<HTMLElement>, blocks: DraftBlock[] = []): Finding[] {
  const deleted = new Map<string, Finding>();
  for (const f of current) if (f.state === 'deleted') deleted.set(findingSignature(f), f);

  // 段落の挿入・削除でずれた残った指摘の block 番号を、要素参照から現在の番号へ写し直す
  const indexByElement = new Map(blocks.map((b) => [b.element, b.index]));
  const merged: Finding[] = [];
  for (const f of current) {
    if (f.blockEl && (!f.blockEl.isConnected || sent.has(f.blockEl))) continue;
    const index = f.blockEl ? indexByElement.get(f.blockEl) : undefined;
    if (index !== undefined && index !== f.block) merged.push({ ...f, block: index });
    else merged.push(f);
  }
  for (const f of incoming) {
    const old = deleted.get(findingSignature(f));
    merged.push(old ? { ...f, state: 'deleted', handledOrder: old.handledOrder } : f);
  }
  const order = (f: Finding) => (f.block === -1 ? Number.MAX_SAFE_INTEGER : f.block);
  return merged.sort((a, b) => order(a) - order(b));
}

interface SchedulerHandlers {
  /** 本文の変更を観測したとき。controller 側の差分フラグを立てる。 */
  onEdit(): void;
  /** 送信タイミング。実際に送るかは呼び先が差分と状態で判断する。 */
  onFire(): void;
  initialDelayMs?: number;
  debounceMs?: number;
  minIntervalMs?: number;
}

/**
 * 本文への MutationObserver を debounce して自動校閲を起こすタイマー。
 * - 初回は短い待ちで、以後は最後の発火から debounce + 最小間隔を守る
 * - IME の変換中は発火しない（compositionend まで保留する）
 * - pause/resume で発火を止め・再開する
 */
export class AutoReviewScheduler {
  private readonly observer: MutationObserver;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private composing = false;
  private paused = false;
  private pending = false;
  private lastFireAt = 0;
  private disposed = false;

  constructor(
    private readonly editor: HTMLElement,
    private readonly handlers: SchedulerHandlers,
  ) {
    this.observer = new MutationObserver(() => this.noteEdit());
  }

  start() {
    this.observer.observe(this.editor, { childList: true, subtree: true, characterData: true });
    this.editor.addEventListener('compositionstart', this.onCompositionStart);
    this.editor.addEventListener('compositionend', this.onCompositionEnd);
  }

  pause() {
    this.paused = true;
    this.clearTimer();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.schedule();
  }

  /** 発火を予約する。実行後・設定読み込み後・再開時にも呼ぶ。 */
  schedule() {
    if (this.disposed || this.paused || this.composing) return;
    this.clearTimer();
    const debounce = this.lastFireAt === 0
      ? this.handlers.initialDelayMs ?? AUTO_REVIEW_INITIAL_DELAY_MS
      : this.handlers.debounceMs ?? AUTO_REVIEW_DEBOUNCE_MS;
    const elapsed = Date.now() - this.lastFireAt;
    const wait = Math.max(debounce, (this.handlers.minIntervalMs ?? AUTO_REVIEW_MIN_INTERVAL_MS) - elapsed);
    this.timer = setTimeout(() => this.fire(), wait);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.clearTimer();
    this.editor.removeEventListener('compositionstart', this.onCompositionStart);
    this.editor.removeEventListener('compositionend', this.onCompositionEnd);
  }

  private noteEdit() {
    this.pending = true;
    this.handlers.onEdit();
    this.schedule();
  }

  private fire() {
    this.timer = null;
    // タイマー成立後に変換が始まった場合は compositionend へ持ち越す
    if (this.composing) { this.pending = true; return; }
    this.pending = false;
    this.lastFireAt = Date.now();
    this.handlers.onFire();
  }

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private onCompositionStart = () => {
    this.composing = true;
  };

  private onCompositionEnd = () => {
    this.composing = false;
    if (this.pending) this.schedule();
  };
}
