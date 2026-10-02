import { describe, expect, test } from 'bun:test';
import { renderPanel, type PanelFinding, type PanelState } from './panel';

function finding(id: string, state: PanelFinding['state']): PanelFinding {
  return {
    id, state, kind: 'typo', block: 0, title: id, reason: '誤字です',
    matches: [{ occurrence: 0, start: 0, from: 'こんにちわ', to: 'こんにちは', before: '', after: '', applied: state === 'resolved', stale: false }],
  };
}

function panel(filter: PanelState['filter'], findings: PanelFinding[]): string {
  return renderPanel({ phase: 'done', view: 'list', filter, selectedId: null, findings, connectionLoading: false });
}

test('検索失敗でも指摘を表示し、全ての事実を確認したと表示しない', () => {
  const state: PanelState = { phase: 'done', view: 'list', filter: 'open', selectedId: null, findings: [finding('誤字の指摘', 'open')], connectionLoading: false };
  const unavailable = renderPanel({ ...state, factCheck: { status: 'unavailable', sourceCheckedBlocks: [] } });
  expect(unavailable).toContain('事実の確認ができませんでした');
  expect(unavailable).toContain('誤字の指摘');
  const partial = renderPanel({ ...state, factCheck: { status: 'partial', sourceCheckedBlocks: [0, 2] } });
  expect(partial).toContain('参照先を取得した段落：1、3');
  expect(partial).toContain('出典付きの指摘以外の主張は未確認');
  expect(partial).not.toContain('指摘はありません');
});

describe('指摘の状態フィルタ', () => {
  test('タブは未対応・対応済みだけで、対応済み件数に適用と削除の両方を含める', () => {
    const html = panel('open', [finding('未対応の指摘', 'open'), finding('適用した指摘', 'resolved'), finding('削除した指摘', 'deleted')]);
    expect(html.match(/data-act="filter"/g)).toHaveLength(2);
    expect(html).toContain('data-f="open" class="on" aria-pressed="true">未対応');
    expect(html).toContain('data-f="handled" class="" aria-pressed="false">対応済み');
    expect(html).toContain('未対応 1 · 対応済み 2');
    expect(html).toContain('data-fid="未対応の指摘"');
    expect(html).not.toContain('data-fid="適用した指摘"');
    expect(html).not.toContain('data-fid="削除した指摘"');
  });

  test('対応済みには状態ラベルと各状態の取り消し操作を表示する', () => {
    const html = panel('handled', [finding('未対応の指摘', 'open'), finding('適用した指摘', 'resolved'), finding('削除した指摘', 'deleted')]);
    expect(html).not.toContain('data-fid="未対応の指摘"');
    expect(html).toContain('data-fid="適用した指摘"');
    expect(html).toContain('data-fid="削除した指摘"');
    expect(html).toContain('class="status">適用済み');
    expect(html).toContain('class="status">削除');
    expect(html).toContain('aria-label="適用を元に戻す"');
    expect(html).toContain('aria-label="復元"');
  });

  test('削除を復元すると対応済みから未対応へ戻り、0件は進捗に表示しない', () => {
    const restored = finding('復元した指摘', 'open');
    const handled = panel('handled', [restored]);
    expect(handled).not.toContain('data-fid="復元した指摘"');
    expect(handled).toContain('指摘はありません');
    expect(handled).not.toContain('対応済み 0');
    const open = panel('open', [restored]);
    expect(open).toContain('data-fid="復元した指摘"');
    expect(open).not.toContain('class="status"');
    expect(open).toContain('aria-label="適用"');
    expect(open).toContain('aria-label="削除"');
  });

  test('一部だけ適用した指摘は未対応に残る', () => {
    const partial = finding('一部適用の指摘', 'open');
    partial.matches.push({ ...partial.matches[0]!, occurrence: 1, applied: true });
    expect(panel('open', [partial])).toContain('data-fid="一部適用の指摘"');
    expect(panel('handled', [partial])).not.toContain('data-fid="一部適用の指摘"');
  });
});
