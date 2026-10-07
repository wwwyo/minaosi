import { describe, expect, test } from 'bun:test';
import { dirtyBlocks, mergeFindings } from './auto-review';
import type { DraftBlock, Finding, MatchSite } from './types';

/** DOM の代わりに使う要素のスタブ。比較は参照の同一性と isConnected だけで行う。 */
function el(connected = true): HTMLElement {
  return { isConnected: connected } as HTMLElement;
}

function block(index: number, text: string, element: HTMLElement = el()): DraftBlock {
  return { index, element, text };
}

function match(from: string, to?: string): MatchSite {
  return { occurrence: 0, start: 0, from, to, before: '', after: '', applied: false, stale: false };
}

function finding(id: string, blockIndex: number, element?: HTMLElement, state: Finding['state'] = 'open', title = id): Finding {
  return { id, kind: 'typo', block: blockIndex, blockEl: element, title, reason: '理由', matches: [match('対象')], state };
}

describe('dirtyBlocks', () => {
  test('初回は全文が送信対象になる', () => {
    const blocks = [block(0, '一'), block(1, '二')];
    expect(dirtyBlocks(blocks, new Map())).toEqual(blocks);
  });

  test('本文が変わったブロックと新しいブロックだけを送る', () => {
    const unchanged = block(0, '一');
    const changed = block(1, '二改');
    const added = block(2, '三');
    const sent = new Map([[unchanged.element, '一'], [changed.element, '二']]);
    expect(dirtyBlocks([unchanged, changed, added], sent)).toEqual([changed, added]);
  });

  test('本文も要素も変わっていなければ何も送らない', () => {
    const a = block(0, '一');
    const sent = new Map([[a.element, '一']]);
    expect(dirtyBlocks([a], sent)).toEqual([]);
  });
});

describe('mergeFindings', () => {
  test('送ったブロックの指摘は応答で置き換わり、送らなかったブロックの指摘と対応状態は残る', () => {
    const sentEl = el();
    const keptEl = el();
    const kept = finding('残る指摘', 1, keptEl, 'resolved');
    const incoming = finding('新しい指摘', 0, sentEl);
    const merged = mergeFindings(
      [finding('消える指摘', 0, sentEl), kept],
      [incoming],
      new Set([sentEl]),
      [block(0, '', sentEl), block(1, '', keptEl)],
    );
    expect(merged.map((f) => f.id)).toEqual(['新しい指摘', '残る指摘']);
    expect(merged.find((f) => f.id === '残る指摘')?.state).toBe('resolved');
  });

  test('本文から外れたブロックの指摘は消える', () => {
    const detached = el(false);
    const merged = mergeFindings([finding('残る指摘', 0), finding('消える指摘', 1, detached)], [], new Set());
    expect(merged.map((f) => f.id)).toEqual(['残る指摘']);
  });

  test('削除した指摘と同じ指摘が再報告されたら削除の判断を引き継ぐ', () => {
    const sentEl = el();
    const deletedFinding = { ...finding('削除した指摘', 0, sentEl, 'deleted', '同じ表題'), handledOrder: 2 };
    const incoming = { ...finding('再報告', 0, sentEl, 'open', '同じ表題'), matches: [match('対象')] };
    const merged = mergeFindings([deletedFinding], [incoming], new Set([sentEl]));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.state).toBe('deleted');
    expect(merged[0]!.handledOrder).toBe(2);
  });

  test('挿入でずれた残った指摘の block 番号は要素参照から現在の番号へ写し直す', () => {
    const keptEl = el();
    // 挿入前は index 0 だった指摘が、先頭に段落が増えて index 1 へずれる
    const kept = finding('残る指摘', 0, keptEl);
    const blocks = [block(0, '', el()), block(1, '', keptEl)];
    const merged = mergeFindings([kept], [], new Set(), blocks);
    expect(merged[0]!.block).toBe(1);
  });
});
