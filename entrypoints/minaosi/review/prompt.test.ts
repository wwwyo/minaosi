import { describe, expect, test } from 'bun:test';
import { parseReport } from './prompt';

const report = (findings: unknown) => ({
  content: [{ type: 'tool_use', name: 'report_findings', input: { findings } }],
});

const base = {
  kind: 'typo',
  title: 't',
  reason: 'r',
  matches: [{ from: 'a' }],
};

describe('parseReport', () => {
  test('tool_use が無い / findings が不正なら error', () => {
    expect(parseReport(null)).toEqual({ error: 'API レスポンスを解釈できません' });
    expect(parseReport({ content: [] })).toEqual({ error: '校閲結果が返りませんでした' });
    expect(parseReport(report('x'))).toEqual({ error: '校閲結果の形式が不正です' });
  });

  test('妥当な指摘は kind 検証済みで返る', () => {
    const r = parseReport(report([base]));
    expect(Array.isArray(r)).toBe(true);
    if (Array.isArray(r)) expect(r[0]?.kind).toBe('typo');
  });

  test('未知の kind・matches なし・title/reason 欠落は除外', () => {
    const r = parseReport(
      report([
        { ...base, kind: 'other' },
        { ...base, matches: undefined },
        { ...base, title: undefined },
        { ...base, reason: 42 },
      ]),
    );
    expect(Array.isArray(r) && r.length === 0).toBe(true);
  });

  test('fact は http(s) URL と excerpt が必須', () => {
    const fact = (source: unknown) => ({ ...base, kind: 'fact', source });
    const ok = fact({ url: 'https://example.com', excerpt: 'e' });
    const noUrl = fact(undefined);
    const jsUrl = fact({ url: 'javascript:alert(1)', excerpt: 'e' });
    const noExcerpt = fact({ url: 'https://example.com' });
    const r = parseReport(report([ok, noUrl, jsUrl, noExcerpt]));
    expect(Array.isArray(r) && r.length === 1).toBe(true);
  });

  test('fact 以外の source はスキームを問わない（href 化は normalize 側で弾く）', () => {
    const r = parseReport(report([{ ...base, source: { url: 'javascript:alert(1)' } }]));
    expect(Array.isArray(r) && r.length === 1).toBe(true);
  });
});
