import { describe, expect, test } from 'bun:test';
import { validateReport } from './schema';
import { styleExceptions, MAX_STYLE_GUIDE_LENGTH } from './style-guide';
import { ReviewInputSchema } from './input';

const guide = '# 文体規範\n本文はですます調。\n\n## 例外\n- 会話部分では口語を許容する\n\n## 語彙\n- 短い言葉を使う';
const blocks = [{ index: 0, text: '「そうだよ」と答えました。不自然な文章だ。' }];
const finding = { kind: 'rule', block: 0, title: '口語', reason: '敬体と常体が混在', matches: [{ from: 'そうだよ', to: 'そうですよ' }] };
const exception = { rule: '会話部分では口語を許容する', reason: '対象はかぎ括弧内の会話部分である' };
const context = { styleGuide: guide, blocks };

describe('文体規範の例外', () => {
  test('明示された例外節だけを読み、通常の規範やコード例を例外にしない', () => {
    expect(styleExceptions(guide)).toEqual([exception.rule]);
    expect(styleExceptions('ですます調。ただし会話は口語を許容。')).toEqual(['ただし会話は口語を許容。']);
    expect(styleExceptions('ですます調。ただし会話は口語を許容しない。')).toEqual([]);
    expect(styleExceptions('```md\n## 例外\n- 全て許容\n```\n## 許容する表現\n- 引用では原文を保つ')).toEqual(['引用では原文を保つ']);
    expect(styleExceptions('````md\n```\n## 例外\n- 全て許容\n~~~\n````')).toEqual([]);
  });

  test('自由文で明示した例外を使い、推測した許容表現を採用しない', () => {
    const rule = 'ただし会話部分は口語を許容';
    const plainContext = { blocks, styleGuide: `本文はですます調。${rule}` };
    expect(validateReport({ findings: [{ ...finding, exception: { ...exception, rule } }] }, plainContext)).toEqual([]);
    expect(validateReport({ findings: [{ ...finding, exception }] }, plainContext)).toEqual([finding]);
    expect(styleExceptions(`\`\`\`txt\n${rule}\n\`\`\``)).toEqual([]);
  });

  test('3スペースまでインデントした例外見出しを認識し、4スペースのコードは見出しにしない', () => {
    for (const indent of [' ', '  ', '   ']) {
      expect(styleExceptions(`${indent}## 例外\n- 会話は口語を許容\n${indent}## 語彙\n- 短い言葉を使う`)).toEqual(['会話は口語を許容']);
    }
    expect(styleExceptions('    ## 例外\n- 会話は口語を許容')).toEqual([]);
  });

  test('閉じるハッシュと余白がある見出し・箇条書きを認識し、空の項目を例外にしない', () => {
    expect(styleExceptions('## 例外 ##  \n  - 会話は口語を許容  \n*    \nただし、 会話は口語を許容。')).toEqual(['会話は口語を許容', 'ただし、 会話は口語を許容。']);
    expect(styleExceptions(`## ${' '.repeat(15_000)}\n- ${' '.repeat(500)}`)).toEqual([]);
  });

  test('例外節の番号付きリストも認識し、通常節の項目は採用しない', () => {
    expect(styleExceptions('## 例外\n1. 会話は口語を許容\n2) 引用は原文を保つ\n## 語彙\n1. 短い言葉を使う')).toEqual(['会話は口語を許容', '引用は原文を保つ']);
    expect(validateReport({ findings: [{ ...finding, exception }] }, { blocks, styleGuide: `## 例外\n1. ${exception.rule}` })).toEqual([]);
  });

  test('インデントしたコード例の箇条書きや自由文で指摘を抑制しない', () => {
    const content = `## 例外\n\n    - ${exception.rule}\n\t1. 引用は原文を保つ\n \tただし会話は口語を許容。`;
    expect(styleExceptions(content)).toEqual([]);
    expect(validateReport({ findings: [{ ...finding, exception }] }, { blocks, styleGuide: content })).toEqual([finding]);
  });

  test('本文と明示された例外に対応する指摘だけを抑制し、通常の指摘は残す', () => {
    const unrelated = { ...finding, title: '本文の常体', matches: [{ from: '不自然な文章だ', to: '不自然な文章です' }] };
    expect(validateReport({ findings: [{ ...finding, exception }, unrelated] }, context)).toEqual([unrelated]);
  });

  test('推測・改変・空の理由・対象不明な抑制は採用せず、内部の抑制情報を返さない', () => {
    for (const value of [undefined, { ...exception, rule: '会話では何でも許容する' }, { ...exception, reason: '' }, { ...exception, rule: '短い言葉を使う' }]) {
      expect(validateReport({ findings: [{ ...finding, exception: value }] }, context)).toEqual([finding]);
    }
    expect(validateReport({ findings: [{ ...finding, exception }] }, { ...context, blocks: [] })).toEqual([finding]);
    expect(validateReport({ findings: [{ ...finding, matches: [{ from: '本文にない文字' }], exception }] }, context))
      .toEqual([{ ...finding, matches: [{ from: '本文にない文字' }] }]);
    expect(validateReport({ findings: [{ ...finding, exception }] })).toEqual([finding]);
    expect(validateReport({ findings: [{ ...finding, matches: [null], exception }] }, context)).toEqual([{ ...finding, matches: [null] }]);
  });

  test('誤字と事実は文体規範で抑制しない', () => {
    const typo = { ...finding, kind: 'typo' };
    const fact = { ...finding, kind: 'fact', source: { url: 'https://official.example', excerpt: '一次情報の引用' } };
    expect(validateReport({ findings: [{ ...typo, exception }, { ...fact, exception }] }, context)).toEqual([typo, fact]);
  });

  test('文体規範があるときだけ文体の指摘を受け付け、明示された例外を適用する', () => {
    const style = { ...finding, kind: 'style' };
    expect(validateReport({ findings: [style] }, context)).toEqual([style]);
    expect(validateReport({ findings: [style] })).toEqual([]);
    expect(validateReport({ findings: [{ ...style, exception }] }, context)).toEqual([]);
  });

  test('標準とBYOKの両方で規範の上限を守り、他ユーザーへ持ち越す設定を持たない', () => {
    for (const input of [{ mode: 'default', blocks }, { mode: 'byok', provider: 'anthropic', model: 'fixture', blocks }]) {
      expect(ReviewInputSchema.parse({ ...input, styleGuide: guide }).styleGuide).toBe(guide);
      expect(ReviewInputSchema.safeParse({ ...input, styleGuide: 'a'.repeat(MAX_STYLE_GUIDE_LENGTH + 1) }).success).toBe(false);
      expect(ReviewInputSchema.parse(input).styleGuide).toBeUndefined();
    }
  });
});
