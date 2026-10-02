import { storage } from '#imports';
import type { ReviewMode, ReviewProvider } from './review/providers';
import type { SavedStyleGuide } from './style-guide';
/** BYOKのキーを拡張のオプションで登録し、ローカルに保持する。 */
export const apiKeyItem = storage.defineItem<string>('local:apiKey', { fallback: '' });
export const modelItem = storage.defineItem<string>('local:model', { fallback: 'claude-sonnet-5' });
export const reviewModeItem = storage.defineItem<ReviewMode>('local:reviewMode', { fallback: 'default' });
export const styleGuideItem = storage.defineItem<SavedStyleGuide | null>('local:styleGuide', { fallback: null });

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

// 廃止したローカル試用経路（opencode-go）の保存値を消す。残すと利用者のキーがstorageに残り続ける。
void storage.removeItems(['local:opencodeKey', 'local:opencodeModel']);
