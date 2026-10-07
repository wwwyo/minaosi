import { expect, test } from 'bun:test';
import { selectReviewEditor, type EditorDetection } from './types';

test('手動で選んだ未判定の候補を自動チェックの対象にしない', () => {
  // このルールはDOM形状ではなく、判定状態と対象の同一性だけを扱う。
  const candidate = {} as HTMLElement;
  const other = {} as HTMLElement;
  const unknown: EditorDetection = { status: 'unknown', candidates: [candidate] };
  expect(selectReviewEditor(unknown, 'manual', candidate)).toBe(candidate);
  expect(selectReviewEditor(unknown, 'automatic', candidate)).toBeNull();
  expect(selectReviewEditor(unknown, 'manual', other)).toBeNull();
  expect(selectReviewEditor(unknown, 'manual', null)).toBeNull();
  expect(unknown.status).toBe('unknown');
  expect(selectReviewEditor({ status: 'none' }, 'manual', candidate)).toBeNull();
  expect(selectReviewEditor({ status: 'confirmed', editor: candidate }, 'automatic', other)).toBe(candidate);
});
