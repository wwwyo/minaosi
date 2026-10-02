import { MAX_STYLE_GUIDE_BYTES, MAX_STYLE_GUIDE_LENGTH } from '@minaosi/api/style-guide';

export interface SavedStyleGuide {
  name: string;
  content: string;
}

/** 選んだUTF-8のテキストを読み込み、校閲リクエストの上限内に収める。 */
export async function readStyleGuideFile(file: File): Promise<SavedStyleGuide> {
  if (!/\.(md|txt)$/i.test(file.name)) throw new Error('文体規範はMarkdown（.md）かテキスト（.txt）を選んでください');
  if (file.size > MAX_STYLE_GUIDE_BYTES) throw new Error('文体規範は64KB以下のファイルを選んでください');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim(); }
  catch { throw new Error('UTF-8のテキストファイルを選んでください'); }
  if (!content || content.includes('\0')) throw new Error('文体規範の文章が入ったテキストファイルを選んでください');
  if (content.length > MAX_STYLE_GUIDE_LENGTH) throw new Error('文体規範は16,000文字以内にしてください');
  return { name: file.name, content };
}
