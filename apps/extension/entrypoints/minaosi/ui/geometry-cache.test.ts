import { describe, expect, test } from 'bun:test';
import { GeometryCache } from './geometry-cache';
import { suggestionPosition, type Box } from './suggestion-layout';

const bounds = { left: 20, top: 0, width: 600, height: 40_000 };
const box = (top: number): Box => ({ left: 20, right: 620, top, bottom: top + 24 });

describe('本文の計測キャッシュ', () => {
  test('長い記事を100回scrollしても本文計測とフォント取得は1回だけ', () => {
    const cache = new GeometryCache<{ font: string }>();
    let measurements = 0;
    const measure = () => {
      measurements++;
      return { rects: Array.from({ length: 1000 }, (_, i) => box(i * 40)), data: { font: '22px' } };
    };
    const first = cache.read(bounds, 600, measure);
    for (let scroll = 0; scroll < 100; scroll++) {
      const layout = cache.read({ ...bounds, top: -scroll * 100 }, 600, measure);
      expect(layout.data).toBe(first.data);
    }
    expect(measurements).toBe(1);
  });

  test('最初は画面外の本文もscroll後に衝突判定へ入る', () => {
    const cache = new GeometryCache<null>();
    const measure = () => ({ rects: [box(0), box(1000)], data: null });
    expect(cache.read(bounds, 600, measure).occupied).toEqual([box(0)]);
    const { occupied } = cache.read({ ...bounds, left: 10, top: -950 }, 600, measure);
    expect(occupied).toEqual([{ left: 10, right: 610, top: 50, bottom: 74 }]);
    const position = suggestionPosition({ left: 100, right: 200, top: 50, bottom: 74 }, { w: 100, h: 24 }, occupied,
      { left: 10, right: 610, top: 8, bottom: 592 })!;
    expect(position).not.toBeNull();
    expect(position.top + 24 <= 50 || position.top >= 74).toBe(true);
  });

  test('候補用に占有配列を変更しても次のscrollへ混入しない', () => {
    const cache = new GeometryCache<null>();
    const measure = () => ({ rects: [box(0)], data: null });
    const first = cache.read(bounds, 600, measure);
    first.occupied[0]!.left = -100;
    first.occupied.push(box(200));
    expect(cache.read(bounds, 600, measure).occupied).toEqual([box(0)]);
  });

  test('本文変更・折り返し変更後は新しい計測値を使う', () => {
    const cache = new GeometryCache<number>();
    let measurements = 0;
    const measure = () => ({ rects: [box(++measurements * 40)], data: measurements });
    cache.read(bounds, 600, measure);
    cache.invalidate();
    expect(cache.read(bounds, 600, measure).data).toBe(2);
    expect(cache.read({ ...bounds, width: 300 }, 600, measure).data).toBe(3);
    expect(cache.read({ ...bounds, width: 300, height: 80_000 }, 600, measure).data).toBe(4);
    expect(measurements).toBe(4);
  });

  test('DOMRectのように座標が非enumerableでもscrollの移動量を計算する', () => {
    const cache = new GeometryCache<null>();
    const rect = Object.create({}, Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, { value }])));
    const measure = () => ({ rects: [box(1000)], data: null });
    cache.read(rect, 600, measure);
    expect(cache.read({ ...bounds, top: -950 }, 600, measure).occupied).toEqual([box(50)]);
  });
});
