import { expect, test } from 'bun:test';
import { MAX_STYLE_GUIDE_BYTES, MAX_STYLE_GUIDE_LENGTH } from '@minaosi/api/style-guide';
import { readStyleGuideFile } from './style-guide';

test('UTF-8の規範を読み込み、ファイル名と内容を保存できる', async () => {
  const content = '# 文体規範\n本文はですます調。\n## 例外\n- 会話部分では口語を許容する';
  expect(await readStyleGuideFile(new File([content], '文体規範.md'))).toEqual({ name: '文体規範.md', content });
  expect(await readStyleGuideFile(new File(['本文は短く。'], 'style.TXT'))).toEqual({ name: 'style.TXT', content: '本文は短く。' });
});

test('空・バイナリ・文字化け・上限超過の規範ファイルを保存しない', async () => {
  const cases = [
    new File([''], 'style.md'),
    new File(['\0本文'], 'style.md'),
    new File([new Uint8Array([0xff, 0xfe])], 'style.md'),
    new File(['本文'], 'style.pdf'),
    new File(['a'.repeat(MAX_STYLE_GUIDE_BYTES + 1)], 'style.md'),
    new File(['a'.repeat(MAX_STYLE_GUIDE_LENGTH + 1)], 'style.md'),
  ];
  for (const file of cases) await expect(readStyleGuideFile(file)).rejects.toThrow();
});
