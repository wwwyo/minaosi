import { describe, expect, test } from 'bun:test';
import { lineBoxes, suggestionPosition, type Box } from './suggestion-layout';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

describe('候補の表示行', () => {
  test('同じ行の複数テキスト断片をまとめ、折り返した行を分ける', () => {
    expect(lineBoxes([box(10, 20, 80, 40), box(80, 20, 110, 40), box(10, 50, 30, 70), box(30, 50, 30, 70)]))
      .toEqual([box(10, 20, 110, 40), box(10, 50, 30, 70)]);
  });
});

describe('候補の配置', () => {
  const bounds = box(8, 8, 792, 592);
  const anchor = box(100, 100, 200, 130);

  test('後続文字がある場合は、その文字の後ろの空間を使う', () => {
    const position = suggestionPosition(anchor, { w: 100, h: 30 }, [box(80, 100, 260, 130)], bounds);
    expect(position).toEqual({ left: 266, top: 100 });
  });

  test('同じ行に空きがあれば、近い上の行へ候補を浮かせない', () => {
    expect(suggestionPosition(anchor, { w: 100, h: 30 }, [box(80, 100, 400, 130)], bounds))
      .toEqual({ left: 406, top: 100 });
  });

  test('横幅が足りない場合は本文と重ならない別の行を使う', () => {
    const occupied = [box(8, 100, 780, 130), box(8, 155, 780, 185)];
    const position = suggestionPosition(anchor, { w: 180, h: 30 }, occupied, bounds)!;
    expect(position).not.toBeNull();
    expect(occupied.every((r) => position.top + 30 <= r.top || position.top >= r.bottom || position.left + 180 <= r.left || position.left >= r.right)).toBe(true);
  });

  test('本文と前の候補の両方を避ける', () => {
    const occupied = [anchor, box(206, 100, 306, 130)];
    const position = suggestionPosition(anchor, { w: 100, h: 30 }, occupied, bounds)!;
    expect(occupied.every((r) => position.top + 30 <= r.top || position.top >= r.bottom || position.left + 100 <= r.left || position.left >= r.right)).toBe(true);
  });

  test('空き領域がない場合は本文の上に重ねない', () => {
    expect(suggestionPosition(anchor, { w: 100, h: 30 }, [bounds], bounds)).toBeNull();
  });
});
