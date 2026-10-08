import { browser, storage } from '#imports';
import type { ReviewMode, ReviewProvider } from './review/providers';
/** BYOKのキーを拡張のオプションで登録し、ローカルに保持する。 */
export const apiKeyItem = storage.defineItem<string>('local:apiKey', { fallback: '' });
export const modelItem = storage.defineItem<string>('local:model', { fallback: 'claude-sonnet-5' });
export const reviewModeItem = storage.defineItem<ReviewMode>('local:reviewMode', { fallback: 'default' });

export const providerItem = storage.defineItem<ReviewProvider>('local:provider', { fallback: 'anthropic' });
export const openaiKeyItem = storage.defineItem<string>('local:openaiKey', { fallback: '' });
export const openaiModelItem = storage.defineItem<string>('local:openaiModel', { fallback: '' });
export const deepseekKeyItem = storage.defineItem<string>('local:deepseekKey', { fallback: '' });
export const deepseekModelItem = storage.defineItem<string>('local:deepseekModel', { fallback: 'deepseek-flash' });

export const PROVIDER_SETTINGS = {
  anthropic: { key: apiKeyItem, model: modelItem },
  openai: { key: openaiKeyItem, model: openaiModelItem },
  deepseek: { key: deepseekKeyItem, model: deepseekModelItem },
};

// 設定画面を削除しても、過去の規範と試用キーがstorageに残り続けるため消す。
// content script からは制限後に届かないため失敗してよい。実際の消去は background／options が担う。
void storage.removeItems(['local:opencodeKey', 'local:opencodeModel', 'local:styleGuide']).catch(() => {});

/**
 * storage.local を trusted context に限定する（ADR 0004）。
 * BYOKキー等を content script（ページ同居プロセス）の読み取り範囲から外す。
 * Firefox 等の未対応環境では何もしない。設定は保持されるが起動ごとに適用する。
 */
export async function restrictStorageToTrustedContexts(): Promise<void> {
  const local = browser.storage?.local as unknown as
    | { setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void> }
    | undefined;
  if (typeof local?.setAccessLevel !== 'function') return;
  try {
    await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // 未対応環境では無視する。キーの実値読みの分離（background 所有）は別途保つ。
  }
}
