export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 同じ表示行の断片をまとめ、明示改行と自動折り返しを別々のアンカーにする。 */
export function lineBoxes(rects: Box[]): Box[] {
  const lines: Box[] = [];
  for (const rect of rects) {
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
    const line = lines.find((box) => Math.abs((box.top + box.bottom - rect.top - rect.bottom) / 2) < 2);
    if (line) {
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.top = Math.min(line.top, rect.top);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else lines.push({ ...rect });
  }
  return lines.sort((a, b) => a.top - b.top);
}

/** 本文と他の候補に重ならない空間のうち、修正箇所に最も近い位置を選ぶ。 */
export function suggestionPosition(
  anchor: Box,
  size: { w: number; h: number },
  occupied: Box[],
  bounds: Box,
): { left: number; top: number } | null {
  const gap = 6;
  const clampX = (x: number) => Math.max(bounds.left, Math.min(x, bounds.right - size.w));
  const inlineTop = (anchor.top + anchor.bottom - size.h) / 2;
  const rows = new Set([inlineTop, ...occupied.flatMap((r) => [r.top - size.h - gap, r.bottom + gap])]);
  let best: { left: number; top: number; distance: number } | null = null;
  for (const top of rows) {
    if (top < bounds.top || top + size.h > bounds.bottom) continue;
    const row = occupied.filter((r) => top < r.bottom + gap && top + size.h > r.top - gap).sort((a, b) => a.left - b.left);
    for (const start of [anchor.right + gap, anchor.left, bounds.left]) {
      let left = clampX(start);
      for (const r of row) {
        if (left < r.right + gap && left + size.w > r.left - gap) left = r.right + gap;
      }
      if (left + size.w > bounds.right) continue;
      const distance = Math.abs(top - inlineTop) * 2 + Math.abs(left - anchor.right - gap);
      if (!best || distance < best.distance) best = { left, top, distance };
    }
  }
  return best && { left: best.left, top: best.top };
}
