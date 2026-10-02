import { expect, test } from 'bun:test';
import { planInlineChanges } from './inline-preview-layout';

test('重なる指摘は選択したカードの修正案を表示する', () => {
  const typo = { fid: 'typo', start: 5, length: 1 };
  const style = { fid: 'style', start: 4, length: 3 };
  const changes = [typo, style];
  expect(planInlineChanges(changes, 'style')).toEqual([style]);
  expect(planInlineChanges(changes, 'typo')).toEqual([typo]);
  expect(changes).toEqual([typo, style]);
});

test('隣接した修正案と別の箇所は維持し、後ろから挿入する', () => {
  const first = { fid: 'first', start: 1, length: 1 };
  const next = { fid: 'next', start: 2, length: 2 };
  const last = { fid: 'last', start: 8, length: 1 };
  expect(planInlineChanges([first, next, last], 'first')).toEqual([last, next, first]);
});
