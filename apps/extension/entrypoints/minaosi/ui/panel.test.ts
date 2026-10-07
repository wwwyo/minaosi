import { describe, expect, test } from 'bun:test';
import { renderPanel, type PanelFinding, type PanelState } from './panel';

function finding(id: string, state: PanelFinding['state'], handledOrder?: number): PanelFinding {
  return {
    id, state, handledOrder, kind: 'typo', block: 0, title: id, reason: '誤字です',
    matches: [{ occurrence: 0, start: 0, from: 'こんにちわ', to: 'こんにちは', before: '', after: '', applied: state === 'resolved', stale: false }],
  };
}

function panel(findings: PanelFinding[], showHandled = false, overrides: Partial<PanelState> = {}): string {
  return renderPanel({ editorStatus: 'confirmed', canReview: true, editorId: 'test-editor', phase: 'done', view: 'list', selectedId: null, findings, connectionLoading: false, auto: 'on', ...overrides }, showHandled);
}

test('検索失敗でも指摘を表示し、全ての事実を確認したと表示しない', () => {
  const state: PanelState = { editorStatus: 'confirmed', canReview: true, editorId: 'test-editor', phase: 'done', view: 'list', selectedId: null, findings: [finding('誤字の指摘', 'open')], connectionLoading: false, auto: 'on' };
  const unavailable = renderPanel({ ...state, factCheck: { status: 'unavailable', sourceCheckedBlocks: [] } });
  expect(unavailable).not.toContain('事実の確認結果はありません');
  expect(unavailable).toContain('誤字の指摘');
  const partial = renderPanel({ ...state, factCheck: { status: 'partial', sourceCheckedBlocks: [0, 2] } });
  expect(partial).toContain('参照先を取得した段落：1、3');
  expect(partial).toContain('出典付きの指摘以外の主張は未確認');
  expect(partial).not.toContain('指摘はありません');
});

describe('未対応と対応済みの一覧', () => {
  test('タブを置かず、既定では未対応と対応済みの見出しだけ表示する', () => {
    const html = panel([finding('未対応の指摘', 'open'), finding('適用した指摘', 'resolved'), finding('削除した指摘', 'deleted')]);
    expect(html).not.toContain('data-act="filter"');
    expect(html).not.toContain('class="prog"');
    expect(html).toContain('<span>対応済み</span>');
    expect(html).toContain('aria-label="対応済みを表示する" aria-expanded="false"');
    expect(html).toContain('data-fid="未対応の指摘"');
    expect(html).not.toContain('data-fid="適用した指摘"');
    expect(html).not.toContain('data-fid="削除した指摘"');
  });

  test('対応済みを表示しても未対応は残り、その下に対応順で積む', () => {
    const html = panel([finding('最後の対応', 'resolved', 3), finding('未対応の指摘', 'open'), finding('最初の対応', 'deleted', 1), finding('二番目の対応', 'resolved', 2)], true);
    const ids = [...html.matchAll(/data-fid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(['未対応の指摘', '最初の対応', '二番目の対応', '最後の対応']);
    expect(html).toContain('aria-label="対応済みを隠す" aria-expanded="true"');
    expect(html).toContain('class="status">適用済み');
    expect(html).toContain('class="status">削除');
    expect(html).toContain('aria-label="適用を元に戻す"');
    expect(html).toContain('aria-label="復元"');
  });

  test('復元後は未対応へ戻り、再対応すると対応済みの末尾へ移る', () => {
    const first = finding('最初の対応', 'deleted', 1);
    const restored = finding('復元した指摘', 'open');
    const restoredHTML = panel([first, restored], true);
    expect(restoredHTML.indexOf('data-fid="復元した指摘"')).toBeLessThan(restoredHTML.indexOf('data-fid="最初の対応"'));
    const handled = panel([finding('復元した指摘', 'resolved', 2), first], true);
    expect(handled.indexOf('data-fid="最初の対応"')).toBeLessThan(handled.indexOf('data-fid="復元した指摘"'));
    expect(handled).not.toContain('未対応 0');
    expect(panel([restored])).not.toContain('handled-section');
  });

  test('一部だけ適用した指摘は表示設定によらず未対応に残る', () => {
    const partial = finding('一部適用の指摘', 'open');
    partial.matches.push({ ...partial.matches[0]!, occurrence: 1, applied: true });
    expect(panel([partial])).toContain('data-fid="一部適用の指摘"');
    expect(panel([partial], true)).toContain('data-fid="一部適用の指摘"');
  });
});
