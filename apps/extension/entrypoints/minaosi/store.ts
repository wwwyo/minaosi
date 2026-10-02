import { storage } from '#imports';
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
