import { expect, test } from 'bun:test';
import { selectReviewEditor, type EditorDetection } from './types';

test('未判定の最大の候補は手動で見直せるが、自動チェックの対象にしない', () => {
  // このルールはDOM形状ではなく、判定状態と候補順だけを扱う。
  const largest = {} as HTMLElement;
  const second = {} as HTMLElement;
  const unknown: EditorDetection = { status: 'unknown', candidates: [largest, second] };
  expect(selectReviewEditor(unknown, 'manual')).toBe(largest);
  expect(selectReviewEditor(unknown, 'automatic')).toBeNull();
  expect(unknown.status).toBe('unknown');
  expect(selectReviewEditor({ status: 'unknown', candidates: [] }, 'manual')).toBeNull();
  expect(selectReviewEditor({ status: 'none' }, 'manual')).toBeNull();
  expect(selectReviewEditor({ status: 'confirmed', editor: second }, 'automatic')).toBe(second);
});
