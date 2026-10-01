import { describe, expect, test } from 'bun:test';
import { captureInText, contextOf, occurrences, seamIndex } from './resolve';

describe('occurrences', () => {
  test('全出現位置を返す', () => {
    expect(occurrences('a a a', 'a')).toEqual([0, 2, 4]);
  });
  test('出現しない / 空 needle', () => {
    expect(occurrences('abc', 'z')).toEqual([]);
    expect(occurrences('abc', '')).toEqual([]);
  });
});

describe('contextOf', () => {
  const t = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz01';
  test('前後32字の文脈を返す', () => {
    const c = contextOf(t, 16, 4); // 'GHIJ'
    expect(c.before).toBe('0123456789ABCDEF');
    expect(c.after).toBe('KLMNOPQRSTUVWXYZabcdefghijklmnop');
    expect(c.after.length).toBe(32);
  });
  test('端では切り詰める', () => {
    const c = contextOf('abc', 0, 1);
    expect(c.before).toBe('');
    expect(c.after).toBe('bc');
  });
});

describe('captureInText', () => {
  test('occurrence 番目の前後文脈と位置を返す', () => {
    const cap = captureInText('a X b X c', 'X', 1);
    expect(cap?.start).toBe(6);
    expect(cap?.before.endsWith('b ')).toBe(true);
    expect(cap?.after.startsWith(' c')).toBe(true);
  });
  test('存在しない occurrence は null', () => {
    expect(captureInText('abc', 'z', 0)).toBeNull();
  });
});

describe('seamIndex', () => {
  test('before+after が縫い目で一致する位置を返す', () => {
    // "価格100円。…" から「100」を削除した本文: 挿入点は "価格" の直後
    expect(seamIndex('価格円。送料200円。', '価格', '円。送料')).toBe(2);
  });
  test('一致なし・複数・空 needle は null', () => {
    expect(seamIndex('xyz', '価格', '円')).toBeNull();
    expect(seamIndex('ab ab', 'a', 'b')).toBeNull();
    expect(seamIndex('abc', '', '')).toBeNull();
  });
});
