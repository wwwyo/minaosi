import type { Box } from './suggestion-layout';

interface EditorBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class GeometryCache<T> {
  private snapshot: { bounds: EditorBounds; rects: Box[]; data: T } | null = null;

  invalidate() {
    this.snapshot = null;
  }

  sizeChanged(bounds: EditorBounds): boolean {
    return this.snapshot !== null && (this.snapshot.bounds.width !== bounds.width || this.snapshot.bounds.height !== bounds.height);
  }

  read(bounds: EditorBounds, viewportHeight: number, measure: () => { rects: Box[]; data: T }): { occupied: Box[]; data: T } {
    if (!this.snapshot || this.sizeChanged(bounds)) {
      const { rects, data } = measure();
      this.snapshot = { bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }, rects, data };
    }
    const { bounds: origin, rects, data } = this.snapshot;
    const dx = bounds.left - origin.left;
    const dy = bounds.top - origin.top;
    // 初回の画面外も保持し、scrollで入ってきた本文を再走査なしで衝突判定する。
    const occupied = rects.filter((r) => r.bottom + dy >= 0 && r.top + dy <= viewportHeight)
      .map((r) => ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy }));
    return { occupied, data };
  }
}
