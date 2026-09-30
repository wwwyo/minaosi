import type { ReviewProvider } from './providers';

/** モデルIDからキーの保存先を選び、他社のキーを誤送信しない。 */
export function providerForModel(model: string): ReviewProvider | null {
  if (/^claude-[a-zA-Z0-9._:-]+$/.test(model)) return 'anthropic';
  if (/^(?:gpt-[a-zA-Z0-9._:-]+|o[1-9](?:-[a-zA-Z0-9._:-]+)?)$/.test(model)) return 'openai';
  return null;
}
